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

#include "edi_source.h"

namespace {
const size_t MAX_EDI_FRAME_SIZE = 1024 * 1024;
uint32_t Read32(const uint8_t* p) {
	return (static_cast<uint32_t>(p[0]) << 24) | (static_cast<uint32_t>(p[1]) << 16) | (p[2] << 8) | p[3];
}
}

// --- EDISource -----------------------------------------------------------------
bool EDISource::CheckFrameCompleted(const SYNC_MAGIC& matched_sync_magic) {
	if(ensemble_frame.size() == 8) {
		invalid_frame = false;
		// 1. header only (to retrieve payload len)
		if(matched_sync_magic.name == "AF") {
			size_t len = Read32(&ensemble_frame[2]);
			if(len > MAX_EDI_FRAME_SIZE - 12) { invalid_frame = true; return true; }
			ensemble_frame.resize(10 + len + 2);
		} else {
			size_t len = Read32(&ensemble_frame[4]);
			if(!len || (len & 7) || len / 8 > MAX_EDI_FRAME_SIZE - 8) { invalid_frame = true; return true; }
			ensemble_frame.resize(4 + 4 + len / 8);
		}
		return false;
	} else {
		// 2. complete packet
		return true;
	}
}

void EDISource::ProcessCompletedFrame(const SYNC_MAGIC& matched_sync_magic) {
	if(invalid_frame) {
		fprintf(stderr, "EDISource: rejected invalid or oversized frame\n");
		observer->EnsembleInputDiscontinuity();
		return;
	}
	// show layer
	if(layer != matched_sync_magic.name) {
		layer = matched_sync_magic.name;
		fprintf(stderr, "EDISource: detected %s layer\n", layer.c_str());
	}

	if(matched_sync_magic.name == "AF") {
		// forward to player
		observer->EnsembleProcessFrame(&ensemble_frame[0]);
	} else {
		// parse TAG packet for TAG items (skipping any TAG packet padding)
		size_t tag_item_len_bytes;
		for(size_t i = 0; i + 8 <= ensemble_frame.size() - 8; i += tag_item_len_bytes) {
			const uint8_t* tag_item = &ensemble_frame[8 + i];

			std::string tag_name((const char*) tag_item, 4);
			size_t tag_len = Read32(tag_item + 4);
			const uint8_t* tag_value = tag_item + 8;

			if(static_cast<uint64_t>(tag_len) > static_cast<uint64_t>(ensemble_frame.size() - 16 - i) * 8) { observer->EnsembleInputDiscontinuity(); return; }
			tag_item_len_bytes = 4 + 4 + (tag_len + 7) / 8;
			if(tag_item_len_bytes > ensemble_frame.size() - 8 - i) { observer->EnsembleInputDiscontinuity(); return; }

			// AF Packet/PFT Fragment
			if(tag_name == "afpf") {
				size_t n = (tag_len + 7) / 8;
				if((tag_len & 7) || n < 12 || tag_value[0] != 'A' || tag_value[1] != 'F' || Read32(tag_value + 2) != n - 12) {
					observer->EnsembleInputDiscontinuity();
					continue;
				}
				// forward to player
				observer->EnsembleProcessFrame(tag_value);

				continue;
			}

			// Timestamp - ignored
			if(tag_name == "time")
				continue;

			fprintf(stderr, "EDISource: ignored unsupported TAG item '%s' (%zu bits)\n", tag_name.c_str(), tag_len);
		}
	}
}
