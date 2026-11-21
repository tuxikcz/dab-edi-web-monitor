/* Copyright (C) 2026 DABlin contributors. GPL-3.0-or-later. */
#include "spi_receiver.h"
#include <cstdio>
#include <ctime>
#include <iomanip>
#include <sstream>
#include <vector>
#include <unistd.h>

namespace {
std::string Quote(const std::string& s) {
	std::ostringstream o; o << '"';
	for(size_t i=0; i<s.size(); ++i) {
		unsigned char c=s[i];
		if(c=='"' || c=='\\') o << '\\' << c;
		else if(c<0x20) o << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<unsigned>(c) << std::dec;
		else o << c;
	}
	o << '"'; return o.str();
}
std::string Date(int64_t epoch) {
	time_t t=static_cast<time_t>(epoch); std::tm tm; char s[32];
	if(static_cast<int64_t>(t)!=epoch || !gmtime_r(&t, &tm) || !std::strftime(s,sizeof(s),"%Y-%m-%dT%H:%M:%SZ",&tm)) return "";
	return s;
}
}
SPIReceiver::SPIReceiver(const std::string& output, bool diagnostics, SPIReceiverObserver* observer) : output(output), diagnostics(diagnostics), msc_frames(0), active(false), exported(false), write_error(false), exported_pi(0), exported_si(0), generation(0), observer(observer), spi(NULL), mot(NULL), packet(NULL) {}
SPIReceiver::~SPIReceiver() {
	if(diagnostics) {
		fprintf(stderr, "EPG summary: MSC frames=%zu exported=%s SI=%u PI=%u programmes=%zu\n", msc_frames, Exported() ? "yes" : "no", spi ? spi->si_objects : 0, spi ? spi->pi_objects : 0, spi ? spi->programmes.size() : 0);
		if(mot) mot->Report();
	}
	delete packet; delete mot; delete spi;
}
void SPIReceiver::Discontinuity() {
	if(!active) return;
	if(diagnostics) fprintf(stderr, "EPG: input discontinuity; resetting carousel\n");
	delete packet; delete mot; delete spi;
	spi = new SPIDecoder(diagnostics); mot = new MOTCarousel(*spi, diagnostics);
	packet = new PacketDataDecoder(current.packet_address, *mot, diagnostics);
	exported_pi = 0;
	exported_si = 0;
	if(observer) observer->SPIStatus("Reception interrupted; waiting for a complete carousel");
}
void SPIReceiver::Reset() {
	delete packet; packet=NULL; delete mot; mot=NULL; delete spi; spi=NULL;
	fic.Reset(); generation=fic.Generation(); active=false; exported=false; exported_pi=0; exported_si=0;
	if(observer) observer->SPIReset();
}
void SPIReceiver::ProcessFIC(const uint8_t* data, size_t len) {
	fic.Process(data, len);
	bool ensemble_changed = generation != fic.Generation();
	generation = fic.Generation();
	const std::set<SPIComponent>& found = fic.Components();
	if(found.empty()) {
		if(active) { delete packet; packet=NULL; delete mot; mot=NULL; delete spi; spi=NULL; active=false; exported=false; exported_pi=0; exported_si=0; if(observer) observer->SPIReset(); }
		return;
	}
	SPIComponent next = *found.begin();
	if(active && !ensemble_changed && !(current < next) && !(next < current)) return;
	delete packet; delete mot; delete spi; current=next;
	spi = new SPIDecoder(diagnostics); mot = new MOTCarousel(*spi, diagnostics);
	packet = new PacketDataDecoder(current.packet_address, *mot, diagnostics); active=true; exported=false; exported_pi=0; exported_si=0;
	if(observer) { if(ensemble_changed) observer->SPIReset(); observer->SPIStatus("Receiving programme information..."); }
	fprintf(stderr,"SPI: SID 0x%X SCIdS %u SCId %u subchannel %u address %u\n", current.service_id, current.component_in_service, current.component_id, current.subchannel, current.packet_address);
}
void SPIReceiver::Subchannel(unsigned id, const uint8_t* data, size_t len) {
	if(!active || id != current.subchannel) return;
	++msc_frames;
	if(diagnostics) fprintf(stderr, "EPG MSC: frame=%zu subchannel=%u bytes=%zu\n", msc_frames, id, len);
	unsigned packet_errors = packet->Errors();
	packet->Feed(data,len);
	// PacketDataDecoder discards the damaged group itself. Keep already verified
	// MOT segments so a single bad packet does not erase the whole carousel.
	if(packet->Errors() != packet_errors) {
		if(diagnostics) fprintf(stderr, "EPG: packet or data-group error; retain verified MOT data and reacquire framing\n");
		if(observer) observer->SPIStatus(exported ? "Reception error; retaining the last complete programme guide" : "Reception error; waiting for a complete programme guide");
		packet->Reset();
	}
	if(mot->Errors() || spi->errors) { Discontinuity(); return; }
	if(mot->Complete() && !spi->errors && !mot->Errors() && !spi->programmes.empty() && (spi->pi_objects != exported_pi || spi->si_objects != exported_si)) {
		if(output.empty() || Export()) {
			exported=true; exported_pi=spi->pi_objects; exported_si=spi->si_objects;
			if(observer) observer->SPIUpdated(spi->services, spi->programmes);
		} else write_error=true;
	}
}
bool SPIReceiver::Export() {
	std::ostringstream out;
	out << "{\"services\":[";
	for(size_t i=0; i<spi->services.size(); ++i) { const SPIService& s=spi->services[i]; if(i) out << ','; out << "{\"name\":" << Quote(s.name) << ",\"bearer\":" << Quote(s.bearer) << '}'; }
	out << "],\"programmes\":[";
	for(size_t i=0; i<spi->programmes.size(); ++i) {
		const SPIProgramme& p=spi->programmes[i]; if(i) out << ',';
		out << "{\"name\":" << Quote(p.name) << ",\"start\":" << Quote(Date(p.start_utc)) << ",\"end\":" << Quote(Date(p.end_utc)) << ",\"short_description\":" << Quote(p.short_description) << ",\"long_description\":" << Quote(p.long_description) << ",\"bearer\":" << Quote(p.bearer) << '}';
	}
	out << "]}\n";
	std::string name = output + ".tmp.XXXXXX";
	std::vector<char> temporary(name.begin(), name.end()); temporary.push_back('\0');
	int fd = mkstemp(temporary.data());
	if(fd < 0) { perror("SPI: cannot create JSON"); return false; }
	FILE* file = fdopen(fd, "wb");
	if(!file) { close(fd); std::remove(temporary.data()); return false; }
	std::string bytes = out.str();
	bool ok = fwrite(bytes.data(), 1, bytes.size(), file) == bytes.size();
	if(fclose(file) != 0) ok = false;
	if(!ok || std::rename(temporary.data(), output.c_str())) { perror("SPI: cannot publish JSON"); std::remove(temporary.data()); return false; }
	fprintf(stderr,"SPI: wrote %zu programmes to %s\n",spi->programmes.size(),output.c_str());
	return true;
}
