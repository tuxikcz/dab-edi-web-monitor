/*
 * DAB packet-mode data group reassembly.
 * Copyright (C) 2026 DABlin contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#ifndef PACKET_DATA_H_
#define PACKET_DATA_H_

#include <cstddef>
#include <cstdint>
#include <vector>

class PacketDataObserver {
public:
	virtual ~PacketDataObserver() {}
	virtual void PacketDataGroup(const std::vector<uint8_t>& group) = 0;
};

// One instance per signalled address. Input must begin at a packet boundary.
class PacketDataDecoder {
public:
	PacketDataDecoder(unsigned address, PacketDataObserver& observer, bool diagnostics = false);
	~PacketDataDecoder();
	void Feed(const uint8_t* data, size_t length);
	void Reset();
	unsigned Errors() const {return errors;}
	bool Incomplete() const {return assembling || !packet.empty();}
private:
	void ProcessPacket(const uint8_t* packet, size_t length);
	unsigned address;
	PacketDataObserver& observer;
	std::vector<uint8_t> packet;
	std::vector<uint8_t> group;
	bool assembling;
	unsigned next_index;
	unsigned errors;
	bool diagnostics;
	size_t packet_lengths[4], packet_crc_bad, groups_ok, groups_bad;
};
#endif
