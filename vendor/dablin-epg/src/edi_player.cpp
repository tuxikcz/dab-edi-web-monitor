/*
    DABlin - capital DAB experience
    Copyright (C) 2019 Stefan Pöschel

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

#include "edi_player.h"
#include <vector>

namespace {
struct Tag {
	const uint8_t* name;
	const uint8_t* value;
	size_t bytes;
	uint32_t bits;
};
uint32_t Read32(const uint8_t* p) {
	return (static_cast<uint32_t>(p[0]) << 24) | (static_cast<uint32_t>(p[1]) << 16) | (p[2] << 8) | p[3];
}
bool Named(const Tag& t, const char* name) { return !memcmp(t.name, name, 4); }
}

void EDIPlayer::DecodeFrame(const uint8_t* frame) {
	// EDISource bounds the AF payload and supplies a complete packet.
	if(frame[0] != 'A' || frame[1] != 'F' || !(frame[8] & 0x80) ||
		(frame[8] & 0x7f) != 0x10 || frame[9] != 'T') {
		if(observer) observer->EnsembleDiscontinuity();
		fprintf(stderr, "EDIPlayer: unsupported AF packet header\n"); return;
	}
	size_t len = Read32(frame + 2);
	uint16_t stored = (frame[10 + len] << 8) | frame[11 + len];
	if(stored != CalcCRC::CalcCRC_CRC16_CCITT.Calc(frame, 10 + len)) {
		if(observer) observer->EnsembleDiscontinuity();
		fprintf(stderr, "EDIPlayer: ignored AF packet with wrong CRC\n"); return;
	}
	unsigned sequence = (frame[6] << 8) | frame[7];
	if(previous_sequence >= 0 && sequence != ((previous_sequence + 1) & 0xffff) && observer)
		observer->EnsembleDiscontinuity();
	previous_sequence = sequence;

	// Validate all TAG boundaries before delivering any payload from this AF packet.
	std::vector<Tag> tags;
	for(size_t p = 0; p < len;) {
		if(len - p < 8) {
			// A TAG packet may be padded with fewer than eight trailing zero bytes.
			for(size_t j = p; j < len; ++j) if(frame[10+j]) {
				if(observer) observer->EnsembleDiscontinuity();
				return;
			}
			break;
		}
		const uint8_t* item = frame + 10 + p;
		uint32_t bits = Read32(item + 4);
		if(static_cast<uint64_t>(bits) > static_cast<uint64_t>(len - p - 8) * 8) { if(observer) observer->EnsembleDiscontinuity(); return; }
		size_t bytes = (static_cast<size_t>(bits) + 7) / 8;
		if(bytes > len - p - 8) { if(observer) observer->EnsembleDiscontinuity(); return; }
		Tag tag = {item, item + 8, bytes, bits};
		if(Named(tag, "deti")) {
			if(bits % 8 || bytes < 6) { if(observer) observer->EnsembleDiscontinuity(); return; }
			bool atst = tag.value[0] & 0x80, fic = tag.value[0] & 0x40, rfud = tag.value[0] & 0x20;
			size_t fic_len = fic ? ((tag.value[3] >> 6) == 3 ? 128 : 96) : 0;
			if(bytes != 6 + (atst ? 8 : 0) + fic_len + (rfud ? 3 : 0) ||
				(tag.value[2] != 0xff && tag.value[2] != 0xf0)) {
				if(observer) observer->EnsembleDiscontinuity();
				return;
			}
		} else if(item[0] == 'e' && item[1] == 's' && item[2] == 't' && item[3] >= 1 && item[3] <= 64) {
			if(bits % 8 || bytes < 3) { if(observer) observer->EnsembleDiscontinuity(); return; }
		} else if(Named(tag, "*ptr") && bits != 64) {
			if(observer) observer->EnsembleDiscontinuity();
			return;
		}
		tags.push_back(tag); p += 8 + bytes;
	}

	// Resolve FIC before any est<n> item, regardless of TAG ordering.
	for(size_t i = 0; i < tags.size(); ++i) {
		const Tag& t = tags[i];
		if(Named(t, "deti") && (t.value[0] & 0x40)) {
			size_t fic_len = (t.value[3] >> 6) == 3 ? 128 : 96;
			ProcessFIC(t.value + 6 + ((t.value[0] & 0x80) ? 8 : 0), fic_len);
		}
	}
	for(size_t i = 0; i < tags.size(); ++i) {
		const Tag& t = tags[i];
		if(t.name[0] == 'e' && t.name[1] == 's' && t.name[2] == 't' && t.name[3] >= 1 && t.name[3] <= 64) {
			unsigned subchid = t.value[0] >> 2;
			if(observer) observer->EnsembleProcessSubchannel(subchid, t.value + 3, t.bytes - 3);
			std::lock_guard<std::mutex> lock(audio_service_mutex);
			if(static_cast<int>(subchid) == audio_service.subchid && dec)
				dec->Feed(t.value + 3, t.bytes - 3);
		} else if(Named(t, "info")) {
			std::string info(reinterpret_cast<const char*>(t.value), t.bytes);
			fprintf(stderr, "EDIPlayer: info TAG item '%s'\n", info.c_str());
		} else if(Named(t, "*ptr") && (memcmp(t.value, "DETI", 4) || t.value[4] || t.value[5] || t.value[6] || t.value[7])) {
			fprintf(stderr, "EDIPlayer: unsupported *ptr protocol or revision\n");
		}
	}
}
