/* Copyright (C) 2026 DABlin contributors. GPL-3.0-or-later. */
#include "spi_fic.h"
#include "tools.h"
#include <tuple>

namespace {
bool ValidFIG(const uint8_t* d, size_t len, unsigned ext, unsigned sidbytes) {
	for(size_t p = 0; p < len;) {
		if(ext == 3) {
			if(len - p < 5) return false;
			size_t n = (d[p+1] & 1) ? 7 : 5;
			if(len - p < n) return false;
			p += n; continue;
		}
		if(len - p < sidbytes + 1) return false;
		p += sidbytes; unsigned info = d[p++];
		if(ext == 2) {
			size_t n = (info & 15) * 2; if(len - p < n) return false;
			p += n;
		} else if(ext == 8) {
			if(p == len) return false;
			size_t n = ((d[p] & 0x80) ? 2 : 1) + ((info & 0x80) ? 1 : 0);
			if(len - p < n) return false;
			p += n;
		} else {
			for(unsigned i = 0; i < (info & 15); ++i) {
				if(len - p < 2) return false;
				size_t n = d[p+1] & 31; p += 2;
				if(len - p < n) return false;
				p += n;
			}
		}
	}
	return true;
}
}
bool SPIComponent::operator<(const SPIComponent& o) const {
	return std::tie(service_id, component_id, component_in_service, subchannel, packet_address) <
		std::tie(o.service_id, o.component_id, o.component_in_service, o.subchannel, o.packet_address);
}
void SPIFIC::Reset() {
	ensemble = -1; ++generation; service_components.clear(); packets.clear(); component_ids.clear(); applications.clear(); components.clear();
}
void SPIFIC::Process(const uint8_t* data, size_t length) {
	for(size_t fib = 0; length - fib >= 32; fib += 32) {
		const uint8_t* f = data + fib;
		if(CalcCRC::CalcCRC_CRC16_CCITT.Calc(f, 30) != (f[30] << 8 | f[31])) continue;
		for(size_t p = 0; p < 30 && f[p] != 0xff;) {
			unsigned type = f[p] >> 5, n = f[p] & 31; ++p;
			if(n > 30 - p) break;
			if(type == 0 && n) FIG(f + p, n);
			p += n;
		}
	}
}
void SPIFIC::FIG(const uint8_t* data, size_t len) {
	unsigned header = *data++; --len;
	if(header & 0xc0) return; // next configuration or other ensemble
	unsigned ext = header & 31, sidbytes = header & 0x20 ? 4 : 2;
	if(ext == 0) {
		if(len < 4) return;
		int id = data[0] << 8 | data[1];
		if(ensemble != -1 && ensemble != id) Reset();
		ensemble = id; return;
	}
	if(ext != 2 && ext != 3 && ext != 8 && ext != 13) return;
	if(!ValidFIG(data, len, ext, sidbytes)) return;
	size_t p = 0;
	while(p < len) {
		if(ext == 3) {
			if(len - p < 5) return;
			unsigned id = (data[p] << 4) | (data[p+1] >> 4);
			bool caorg = data[p+1] & 1;
			if(len - p < (caorg ? 7u : 5u)) return;
			Packet packet = {static_cast<unsigned>(data[p+3] >> 2), static_cast<unsigned>(((data[p+3] & 3) << 8) | data[p+4]),
				!caorg && !(data[p+2] & 0x80) && (data[p+2] & 0x3f) == 60};
			if(packets.size() < 128 || packets.count(id)) packets[id] = packet;
			p += caorg ? 7 : 5; continue;
		}
		if(len - p < sidbytes + 1) return;
		uint32_t sid = 0; for(unsigned i = 0; i < sidbytes; ++i) sid = (sid << 8) | data[p++];
		unsigned info = data[p++];
		if(ext == 2) {
			unsigned count = info & 15;
			if(len - p < count * 2) return;
			std::set<unsigned> ids;
			for(unsigned i = 0; i < count; ++i, p += 2)
				if((data[p] >> 6) == 3 && !(data[p+1] & 1)) ids.insert(((data[p] & 63) << 6) | (data[p+1] >> 2));
			if(service_components.size() < 128 || service_components.count(sid)) service_components[sid] = ids;
		} else if(ext == 8) {
			if(p >= len) return;
			bool extra = info & 0x80, longform = data[p] & 0x80;
			size_t n = (longform ? 2 : 1) + (extra ? 1 : 0);
			if(len - p < n) return;
			Key key(sid, info & 15);
			if(longform && (component_ids.size() < 256 || component_ids.count(key)))
				component_ids[key] = ((data[p] & 15) << 8) | data[p+1];
			else if(!longform) component_ids.erase(key);
			p += n;
		} else {
			Key key(sid, info >> 4); unsigned count = info & 15; bool spi = false;
			for(unsigned i = 0; i < count; ++i) {
				if(len - p < 2) return;
				unsigned type = (data[p] << 3) | (data[p+1] >> 5), n = data[p+1] & 31; p += 2;
				if(len - p < n) return;
				if(type == 7) spi = true;
				p += n;
			}
			if(spi && applications.size() < 256) applications.insert(key); else if(!spi) applications.erase(key);
		}
	}
	Rebuild();
}
void SPIFIC::Rebuild() {
	std::set<SPIComponent> found;
	for(std::set<Key>::const_iterator a = applications.begin(); a != applications.end(); ++a) {
		std::map<Key,unsigned>::const_iterator c = component_ids.find(*a);
		std::map<uint32_t,std::set<unsigned> >::const_iterator s = service_components.find(a->first);
		if(c == component_ids.end() || s == service_components.end() || !s->second.count(c->second)) continue;
		std::map<unsigned,Packet>::const_iterator p = packets.find(c->second);
		if(p == packets.end() || !p->second.usable || !p->second.address) continue;
		SPIComponent result = {a->first, c->second, a->second, p->second.subchannel, p->second.address}; found.insert(result);
	}
	components.swap(found);
}
