/* Copyright (C) 2026 DABlin contributors. GPL-3.0-or-later. */
#ifndef SPI_FIC_H_
#define SPI_FIC_H_
#include <cstdint>
#include <cstddef>
#include <map>
#include <set>
#include <utility>

struct SPIComponent {
	uint32_t service_id;
	unsigned component_id, component_in_service, subchannel, packet_address;
	bool operator<(const SPIComponent& rhs) const;
};

// Discovers packet-mode SPI components by correlating FIG 0/2, 0/3, 0/8, 0/13.
// Its state is deliberately independent from the audio service selection.
class SPIFIC {
public:
	SPIFIC() : ensemble(-1), generation(0) {}
	void Process(const uint8_t* data, size_t length);
	void Reset();
	const std::set<SPIComponent>& Components() const { return components; }
	unsigned Generation() const { return generation; }
private:
	typedef std::pair<uint32_t, unsigned> Key;
	struct Packet { unsigned subchannel, address; bool usable; };
	void FIG(const uint8_t* data, size_t len);
	void Rebuild();
	int ensemble;
	unsigned generation;
	std::map<uint32_t, std::set<unsigned> > service_components;
	std::map<unsigned, Packet> packets;
	std::map<Key, unsigned> component_ids;
	std::set<Key> applications;
	std::set<SPIComponent> components;
};
#endif
