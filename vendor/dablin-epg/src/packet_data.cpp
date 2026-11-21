/*
 * DAB packet-mode data group reassembly.
 * Copyright (C) 2026 DABlin contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include "packet_data.h"
#include "tools.h"
#include <algorithm>

namespace {
const size_t MAX_GROUP_SIZE = 65536;
bool ValidCRC(const uint8_t* data, size_t length) {
	if(length < 2)
		return false;
	uint16_t expected = static_cast<uint16_t>(data[length - 2] << 8 | data[length - 1]);
	return expected == CalcCRC::CalcCRC_CRC16_CCITT.Calc(data, length - 2);
}
}

PacketDataDecoder::PacketDataDecoder(unsigned address, PacketDataObserver& observer, bool diagnostics) :
	address(address), observer(observer), assembling(false), next_index(0), errors(0), diagnostics(diagnostics), packet_crc_bad(0), groups_ok(0), groups_bad(0) {
	std::fill(packet_lengths, packet_lengths + 4, 0);
}
PacketDataDecoder::~PacketDataDecoder() {
	if(diagnostics) fprintf(stderr, "EPG summary: packets 24=%zu 48=%zu 72=%zu 96=%zu packet_CRC_bad=%zu groups_CRC_ok=%zu groups_CRC_bad=%zu\n", packet_lengths[0], packet_lengths[1], packet_lengths[2], packet_lengths[3], packet_crc_bad, groups_ok, groups_bad);
}

void PacketDataDecoder::Reset() {
	packet.clear();
	group.clear();
	assembling = false;
}

void PacketDataDecoder::Feed(const uint8_t* data, size_t length) {
	while(length) {
		if(packet.empty()) {
			packet.push_back(*data++);
			--length;
		}
		size_t packet_size = ((packet[0] >> 6) + 1) * 24;
		size_t count = std::min(length, packet_size - packet.size());
		packet.insert(packet.end(), data, data + count);
		data += count;
		length -= count;
		if(packet.size() == packet_size) {
			ProcessPacket(&packet[0], packet.size());
			packet.clear();
		}
	}
}

void PacketDataDecoder::ProcessPacket(const uint8_t* data, size_t length) {
	unsigned packet_address = ((data[0] & 3) << 8) | data[1];
	bool crc_ok = (diagnostics || packet_address == address) ? ValidCRC(data, length) : true;
	if(diagnostics) {
		++packet_lengths[length / 24 - 1];
		if(!crc_ok) ++packet_crc_bad;
		fprintf(stderr, "EPG packet: length=%zu address=%u CRC=%s\n", length, packet_address, crc_ok ? "ok" : "bad");
	}
	if(packet_address != address || address == 0 || address > 1023)
		return;
	unsigned index = (data[0] >> 4) & 3;
	bool first = data[0] & 8;
	bool last = data[0] & 4;
	size_t useful = data[2] & 0x7f;
	if(!crc_ok || (data[2] & 0x80) || useful > length - 5) {
		if(diagnostics) fprintf(stderr, "EPG packet: rejected %s\n", !crc_ok ? "packet CRC" : (data[2] & 0x80) ? "command packet" : "invalid useful length");
		++errors;
		group.clear();
		assembling = false;
		return;
	}
	if(first) {
		if(assembling) { ++errors; if(diagnostics) fprintf(stderr, "EPG group: interrupted by new first packet\n"); }
		group.clear();
		assembling = true;
	} else if(!assembling) {
		if(diagnostics) fprintf(stderr, "EPG packet: waiting for first packet of a data group\n");
		return;
	} else if(index != next_index) {
		if(diagnostics) fprintf(stderr, "EPG group: rejected continuity index=%u expected=%u\n", index, next_index);
		++errors;
		group.clear();
		assembling = false;
		return;
	}
	next_index = (index + 1) & 3;
	if(useful > MAX_GROUP_SIZE - group.size()) {
		if(diagnostics) fprintf(stderr, "EPG group: rejected size limit\n");
		++errors;
		group.clear();
		assembling = false;
		return;
	}
	group.insert(group.end(), data + 3, data + 3 + useful);
	if(last) {
		assembling = false;
		// Current transmissions carry a CRC; legacy groups without one are rejected.
		if(group.size() >= 4 && (group[0] & 0x40) && ValidCRC(&group[0], group.size())) {
			++groups_ok;
			if(diagnostics) fprintf(stderr, "EPG group: type=%u length=%zu CRC=ok\n", group[0] & 15, group.size());
			observer.PacketDataGroup(group);
		} else {
			++groups_bad;
			if(diagnostics) fprintf(stderr, "EPG group: rejected %s (length=%zu)\n", group.size() < 4 ? "truncated data group" : !(group[0] & 0x40) ? "missing CRC flag" : "invalid data group CRC", group.size());
			++errors;
		}
		group.clear();
	}
}
