/*
    DABlin - capital DAB experience
    Copyright (C) 2015-2024 Stefan Pöschel

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

#include "dablin.h"
#include <getopt.h>

#include <errno.h>
#include <sys/stat.h>

static DABlinText *dablin = nullptr;

static void break_handler(int) {
	fprintf(stderr, "...DABlin exits...\n");
	if(dablin)
		dablin->DoExit();
}


static void usage(const char* exe) {
	fprint_dablin_banner(stderr);
	fprintf(stderr, "Usage: %s [OPTIONS] [file]\n", exe);
	fprintf(stderr, "  --epg-json <file>  Export experimental SPI EPG from ETI or EDI AF to JSON\n");
	fprintf(stderr, "  --epg-diagnostics  Log SPI MSC packets, CRCs, MOT and decoded objects\n");
	fprintf(stderr, "  -h            Show this help\n"
					"  -f <format>   Source format: \"%s\" (default), \"%s\"\n"
					"  -d <binary>   Use DAB live source (using the mentioned binary)\n"
					"  -D <type>     DAB live source type: \"%s\" (default), \"%s\"\n"
					"  -c <ch>       Channel to be played (requires DAB live source)\n"
					"  -l <label>    Label of the service to be played\n"
					"  -1            Play the first service found\n"
					"  -s <sid>      ID of the service to be played\n"
					"  -x <scids>    ID of the service component to be played (requires service ID)\n"
					"  -r <subchid>  ID of the sub-channel (DAB) to be played\n"
					"  -R <subchid>  ID of the sub-channel (DAB+) to be played\n"
					"  -g <gain>     USB stick gain to pass to DAB live source (auto gain is default)\n"
					"  -G            Use default gain for DAB live source (instead of auto gain)\n"
					"  -p            Output raw PCM to stdout instead of using SDL\n"
					"  -w            Output RIFF WAVE with PCM to stdout instead of using SDL (useful only on Little Endian)\n"
					"  -u            Output untouched audio stream to stdout instead of using SDL\n"
					"  -I            Don't catch up on stream after interruption\n"
					"  -F            Disable dynamic FIC messages (dynamic PTY, announcements)\n"
					"  -j            Export PAD metadata as JSON lines to stderr\n"
					"  -J <dir>      Export PAD metadata and write MOT Slideshow images to directory\n"
					"  file          Input file to be played (stdin, if not specified)\n",
					EnsembleSource::FORMAT_ETI.c_str(),
					EnsembleSource::FORMAT_EDI.c_str(),
					DABLiveETISource::TYPE_DAB2ETI.c_str(),
					DABLiveETISource::TYPE_ETI_CMDLINE.c_str()
			);
	exit(1);
}


int main(int argc, char **argv) {
	// handle signals
	if(signal(SIGINT, break_handler) == SIG_ERR) {
		perror("DABlin: error while setting SIGINT handler");
		return 1;
	}
	if(signal(SIGTERM, break_handler) == SIG_ERR) {
		perror("DABlin: error while setting SIGTERM handler");
		return 1;
	}

	DABlinTextOptions options;
	int initial_param_count = 0;
	int gain_param_count = 0;

	// option args
	int c;
	static const struct option long_options[] = {{"epg-json", required_argument, NULL, 1000}, {"epg-diagnostics", no_argument, NULL, 1001}, {NULL, 0, NULL, 0}};
	while((c = getopt_long(argc, argv, "hf:c:l:d:D:g:Gs:x:1pwuIFr:R:jJ:", long_options, NULL)) != -1) {
		switch(c) {
		case 1000:
			options.epg_json = optarg;
			break;
		case 1001:
			options.epg_diagnostics = true;
			break;
		case 'h':
			usage(argv[0]);
			break;
		case 'f':
			options.source_format = optarg;
			break;
		case 'd':
			options.dab_live_source_binary = optarg;
			break;
		case 'D':
			options.dab_live_source_type = optarg;
			break;
		case 'c':
			options.initial_channel = optarg;
			break;
		case 'l':
			options.initial_label = optarg;
			initial_param_count++;
			break;
		case '1':
			options.initial_first_found_service = true;
			initial_param_count++;
			break;
		case 's':
			options.initial_sid = strtol(optarg, nullptr, 0);
			initial_param_count++;
			break;
		case 'x':
			options.initial_scids = strtol(optarg, nullptr, 0);
			break;
		case 'r':
			options.initial_subchid_dab = strtol(optarg, nullptr, 0);
			initial_param_count++;
			break;
		case 'R':
			options.initial_subchid_dab_plus = strtol(optarg, nullptr, 0);
			initial_param_count++;
			break;
		case 'g':
			options.gain = strtol(optarg, nullptr, 0);
			gain_param_count++;
			break;
		case 'G':
			options.gain = DAB_LIVE_SOURCE_CHANNEL::default_gain;
			gain_param_count++;
			break;
		case 'p':
			options.pcm_output = true;
			break;
		case 'w':
			options.wav_output = true;
			break;
		case 'u':
			options.untouched_output = true;
			break;
		case 'I':
			options.disable_int_catch_up = true;
			break;
		case 'F':
			options.disable_dyn_fic_msgs = true;
			break;
		case 'j':
			options.metadata_json = true;
			break;
		case 'J':
			options.metadata_json = true;
			options.metadata_slide_dir = optarg;
			break;
		case '?':
		default:
			usage(argv[0]);
		}
	}

	// non-option args
	switch(argc - optind) {
	case 0:
		break;
	case 1:
		options.filename = argv[optind];
		break;
	default:
		usage(argv[0]);
	}

	// ensure valid options
	if(options.epg_diagnostics && options.epg_json.empty()) {
		fprintf(stderr, "--epg-diagnostics requires --epg-json\n");
		return 1;
	}
	if(options.dab_live_source_binary.empty()) {
		if(!options.initial_channel.empty()) {
			fprintf(stderr, "If a channel is selected, DAB live source must be used!\n");
			usage(argv[0]);
		}
	} else {
		if(options.source_format != EnsembleSource::FORMAT_ETI) {
			fprintf(stderr, "A DAB live source can only be used with ETI source format!\n");
			usage(argv[0]);
		}
		if(!options.filename.empty()) {
			fprintf(stderr, "Both a file and DAB live source cannot be used as source!\n");
			usage(argv[0]);
		}
		if(options.initial_channel.empty()) {
			fprintf(stderr, "If DAB live source is used, a channel must be selected!\n");
			usage(argv[0]);
		}
		if(dab_channels.find(options.initial_channel) == dab_channels.end()) {
			fprintf(stderr, "The channel '%s' is not supported!\n", options.initial_channel.c_str());
			usage(argv[0]);
		}
		if(options.dab_live_source_type != DABLiveETISource::TYPE_DAB2ETI && options.dab_live_source_type != DABLiveETISource::TYPE_ETI_CMDLINE) {
			fprintf(stderr, "The DAB live source type '%s' is not supported!\n", options.dab_live_source_type.c_str());
			usage(argv[0]);
		}
	}
	if(options.initial_scids != LISTED_SERVICE::scids_none && options.initial_sid == LISTED_SERVICE::sid_none) {
		fprintf(stderr, "The service component ID requires the service ID to be specified!\n");
		usage(argv[0]);
	}
#ifdef DABLIN_DISABLE_SDL
	if(!options.pcm_output && !options.wav_output && !options.untouched_output && options.epg_json.empty()) {
		fprintf(stderr, "SDL output was disabled, so PCM output must be selected!\n");
		usage(argv[0]);
	}
#endif

	if(options.pcm_output + options.wav_output + options.untouched_output > 1) {
		fprintf(stderr, "No more than one output option can be specified!\n");
		usage(argv[0]);
	}


	// at most one param needed!
	if(initial_param_count > 1) {
		fprintf(stderr, "At most one initial parameter shall be specified!\n");
		usage(argv[0]);
	}
	if(gain_param_count > 1) {
		fprintf(stderr, "At most one gain parameter shall be specified!\n");
		usage(argv[0]);
	}


	fprint_dablin_banner(stderr);

	dablin = new DABlinText(options);
	int result = dablin->Main();
	delete dablin;

	return result;
}



// --- DABlinText -----------------------------------------------------------------
DABlinText::DABlinText(DABlinTextOptions options) {
	this->options = options;
	spi_receiver = options.epg_json.empty() ? nullptr : new SPIReceiver(options.epg_json, options.epg_diagnostics);

	// set XTerm window title to version string
	fprintf(stderr, "\x1B]0;" "DABlin v" DABLIN_VERSION "\a");

	AudioOutputType audio_output_type = AudioOutputType::SDL;
#ifndef DABLIN_DISABLE_SDL
	if(options.pcm_output)
#endif
		audio_output_type = AudioOutputType::PCM;
	if(options.wav_output)
		audio_output_type = AudioOutputType::WAV;
	if(options.untouched_output)
		audio_output_type = AudioOutputType::Untouched;

	if(options.source_format == EnsembleSource::FORMAT_ETI)
		ensemble_player = new ETIPlayer(audio_output_type, options.disable_int_catch_up, this);
	else
		ensemble_player = new EDIPlayer(audio_output_type, options.disable_int_catch_up, this);

	// set initial sub-channel, if desired
	if(options.initial_subchid_dab != AUDIO_SERVICE::subchid_none) {
		ensemble_player->SetAudioService(AUDIO_SERVICE(options.initial_subchid_dab, false));

		// set XTerm window title to sub-channel number
		fprintf(stderr, "\x1B]0;" "Sub-channel %d (DAB) - DABlin" "\a", options.initial_subchid_dab);
	}
	if(options.initial_subchid_dab_plus != AUDIO_SERVICE::subchid_none) {
		ensemble_player->SetAudioService(AUDIO_SERVICE(options.initial_subchid_dab_plus, true));

		// set XTerm window title to sub-channel number
		fprintf(stderr, "\x1B]0;" "Sub-channel %d (DAB+) - DABlin" "\a", options.initial_subchid_dab_plus);
	}

	if(options.source_format == EnsembleSource::FORMAT_ETI) {
		if(options.dab_live_source_binary.empty()) {
			ensemble_source = new ETISource(options.filename, this);
		} else {
			DAB_LIVE_SOURCE_CHANNEL channel(options.initial_channel, dab_channels.at(options.initial_channel), options.gain);

			if(options.dab_live_source_type == DABLiveETISource::TYPE_ETI_CMDLINE)
				ensemble_source = new EtiCmdlineETISource(options.dab_live_source_binary, channel, this);
			else
				ensemble_source = new DAB2ETIETISource(options.dab_live_source_binary, channel, this);
		}
	} else {
		ensemble_source = new EDISource(options.filename, this);
	}

	fic_decoder = new FICDecoder(this, options.disable_dyn_fic_msgs);
	pad_decoder = new PADDecoder(this, false);
}

DABlinText::~DABlinText() {
	DoExit();
	delete ensemble_source;
	delete ensemble_player;
	delete fic_decoder;
	delete pad_decoder;
	delete spi_receiver;
}

int DABlinText::Main() {
	int result = ensemble_source->Main();
	if(!result && spi_receiver && !spi_receiver->Exported()) {
		fprintf(stderr, "SPI: no complete programme information exported\n");
		return 1;
	}
	return result;
}

void DABlinText::EnsembleUpdateProgress(const ENSEMBLE_PROGRESS& progress) {
	// compensate cursor movement
	std::string format = "\x1B[34m" "%s" "\x1B[0m";
	format.append(progress.text.length(), '\b');

	fprintf(stderr, format.c_str(), progress.text.c_str());
}

void DABlinText::FICChangeService(const LISTED_SERVICE& service) {
//	fprintf(stderr, "### FICChangeService\n");

	std::string label = FICDecoder::ConvertLabelToUTF8(service.label, nullptr);

	// if first found service requested, adopt service params (for possible later changes)
	if(options.initial_first_found_service) {
		options.initial_sid = service.sid;
		options.initial_scids = service.scids;
		options.initial_first_found_service = false;
	}

	// abort, if no/not initial service
	if(!(label == options.initial_label || (service.sid == options.initial_sid && service.scids == options.initial_scids)))
		return;

	// if the audio service changed, switch
	if(!ensemble_player->IsSameAudioService(service.audio_service))
		ensemble_player->SetAudioService(service.audio_service);
	if(service.sls_app_type >= 0)
		pad_decoder->SetMOTAppType(service.sls_app_type);

	// set XTerm window title to service name
	fprintf(stderr, "\x1B]0;" "%s - DABlin" "\a", label.c_str());
}

void DABlinText::FICDiscardedFIB() {
	fprintf(stderr, "\x1B[33m" "(FIB)" "\x1B[0m" " ");
}

static std::string json_escape(const std::string& value) {
	std::string result;
	for(char c : value) {
		switch(c) {
		case '\\': result += "\\\\"; break;
		case '"': result += "\\\""; break;
		case '\b': result += "\\b"; break;
		case '\f': result += "\\f"; break;
		case '\n': result += "\\n"; break;
		case '\r': result += "\\r"; break;
		case '\t': result += "\\t"; break;
		default:
			if((unsigned char) c < 0x20) {
				char escaped[7];
				snprintf(escaped, sizeof(escaped), "\\u%04x", c);
				result += escaped;
			} else {
				result += c;
			}
		}
	}
	return result;
}

static bool ensure_dir(const std::string& dir) {
	if(dir.empty())
		return false;
	if(mkdir(dir.c_str(), 0775) == 0 || errno == EEXIST)
		return true;
	fprintf(stderr, "DABlin metadata: cannot create directory '%s': %s\n", dir.c_str(), strerror(errno));
	return false;
}

static const char* slide_extension(const MOT_FILE& slide) {
	switch(slide.content_sub_type) {
	case MOT_FILE::CONTENT_SUB_TYPE_JFIF:
		return "jpg";
	case MOT_FILE::CONTENT_SUB_TYPE_PNG:
		return "png";
	default:
		return "bin";
	}
}

void DABlinText::EnsembleProcessPAD(const uint8_t *xpad_data, size_t xpad_len, bool exact_xpad_len, const uint8_t* fpad_data) {
	if(options.metadata_json || !options.metadata_slide_dir.empty())
		pad_decoder->Process(xpad_data, xpad_len, exact_xpad_len, fpad_data);
}

void DABlinText::PADChangeDynamicLabel(const DL_STATE& dl) {
	if(!options.metadata_json)
		return;

	std::string text;
	CharsetTools::ConvertTextToUTF8(dl.raw.data(), dl.raw.size(), dl.charset, false, &text);

	fprintf(stderr, "{\"type\":\"dynamic_label\",\"text\":\"%s\",\"dl_plus\":[", json_escape(text).c_str());
	for(size_t i = 0; i < dl.dl_plus_objects.size(); i++) {
		const DL_PLUS_OBJECT& object = dl.dl_plus_objects[i];
		if(i > 0)
			fprintf(stderr, ",");
		fprintf(stderr, "{\"content_type\":%d,\"content_type_name\":\"%s\",\"text\":\"%s\"}",
				object.content_type,
				json_escape(DynamicLabelDecoder::ConvertDLPlusContentTypeToString(object.content_type)).c_str(),
				json_escape(object.text).c_str());
	}
	fprintf(stderr, "]}\n");
}

void DABlinText::PADChangeSlide(const MOT_FILE& slide) {
	std::string filename;
	if(!options.metadata_slide_dir.empty() && ensure_dir(options.metadata_slide_dir)) {
		filename = options.metadata_slide_dir + "/slide." + slide_extension(slide);
		FILE *file = fopen(filename.c_str(), "wb");
		if(file) {
			fwrite(slide.data.data(), 1, slide.data.size(), file);
			fclose(file);
		} else {
			fprintf(stderr, "DABlin metadata: cannot write slide '%s': %s\n", filename.c_str(), strerror(errno));
			filename.clear();
		}
	}

	if(options.metadata_json) {
		fprintf(stderr, "{\"type\":\"slideshow\",\"content_type\":%d,\"content_sub_type\":%d,\"size\":%zu,\"content_name\":\"%s\",\"category_title\":\"%s\",\"click_through_url\":\"%s\",\"file\":\"%s\"}\n",
				slide.content_type,
				slide.content_sub_type,
				slide.data.size(),
				json_escape(slide.content_name).c_str(),
				json_escape(slide.category_title).c_str(),
				json_escape(slide.click_through_url).c_str(),
				json_escape(filename).c_str());
	}
}

void DABlinText::PADFileProgress(const double fraction) {
	if(options.metadata_json)
		fprintf(stderr, "{\"type\":\"slideshow_progress\",\"fraction\":%.6f}\n", fraction);
}
