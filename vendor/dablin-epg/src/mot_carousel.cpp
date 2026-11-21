/* Copyright (C) 2026 DABlin contributors. GPL-3.0-or-later. */
#include "mot_carousel.h"
#include <algorithm>
#include <cstdio>

namespace { const size_t MAX_BYTES = 1024 * 1024; const size_t MAX_OBJECTS = 128; }
void MOTCarousel::Report() const {
	if(!diagnostics) return;
	fprintf(stderr, "EPG summary: MOT directory objects=%zu complete=%s\n", objects.size(), Complete() ? "yes" : "no");
	for(std::map<unsigned, Object>::const_iterator i = objects.begin(); i != objects.end(); ++i)
		fprintf(stderr, "EPG summary: transport_id=%u body=%zu/%zu assembled=%zu\n", i->first, i->second.delivered.size(), i->second.expected, i->second.body.size);
}
bool MOTCarousel::Complete() const {
	if(objects.empty()) return false;
	for(std::map<unsigned, Object>::const_iterator i = objects.begin(); i != objects.end(); ++i)
		if(i->second.delivered.size() != i->second.expected) return false;
	return true;
}
bool MOTCarousel::Segments::Add(unsigned n, bool final, const uint8_t* data, size_t len) {
	if(n >= 4096 || len > MAX_BYTES || (last >= 0 && n > static_cast<unsigned>(last))) return false;
	std::vector<uint8_t> v(data, data + len);
	std::map<unsigned, std::vector<uint8_t> >::iterator i = chunks.find(n);
	if(i != chunks.end() && i->second != v) return false;
	if(final && last >= 0 && last != static_cast<int>(n)) return false;
	if(final && !chunks.empty() && chunks.rbegin()->first > n) return false;
	if(i == chunks.end()) {
		if(len > MAX_BYTES - size) return false;
		chunks[n] = v; size += len;
	}
	if(final) last = n;
	return true;
}
bool MOTCarousel::Segments::Complete() const {
	return last >= 0 && chunks.size() == static_cast<size_t>(last) + 1;
}
std::vector<uint8_t> MOTCarousel::Segments::Join() const {
	std::vector<uint8_t> result;
	result.reserve(size);
	for(std::map<unsigned, std::vector<uint8_t> >::const_iterator i = chunks.begin(); i != chunks.end(); ++i)
		result.insert(result.end(), i->second.begin(), i->second.end());
	return result;
}
bool MOTCarousel::Directory(const std::vector<uint8_t>& d) {
	if(d.size() < 13) { if(diagnostics) fprintf(stderr, "EPG MOT: directory header shorter than 13 bytes\n"); return false; }
	if(d[0] & 0xc0) { if(diagnostics) fprintf(stderr, "EPG MOT: compressed directory or reserved flag unsupported\n"); return false; }
	size_t size = (static_cast<size_t>(d[0] & 0x3f) << 24) | (d[1] << 16) | (d[2] << 8) | d[3];
	unsigned count = (d[4] << 8) | d[5];
	size_t off = 13 + (d[11] << 8 | d[12]);
	if(size != d.size()) { if(diagnostics) fprintf(stderr, "EPG MOT: directory size=%zu actual=%zu\n", size, d.size()); return false; }
	if(count > MAX_OBJECTS) { if(diagnostics) fprintf(stderr, "EPG MOT: directory object count exceeds limit\n"); return false; }
	if(off > d.size() || (d[9] & 0x80)) { if(diagnostics) fprintf(stderr, "EPG MOT: invalid directory extension length or reserved flag\n"); return false; }
	if(diagnostics) fprintf(stderr, "EPG MOT: directory length=%zu objects=%u\n", size, count);
	std::map<unsigned, Object> updated;
	for(unsigned i = 0; i < count; ++i) {
		if(d.size() - off < 9) { if(diagnostics) fprintf(stderr, "EPG MOT: truncated directory entry\n"); return false; }
		unsigned id = d[off] << 8 | d[off + 1]; off += 2;
		size_t body = (static_cast<size_t>(d[off]) << 20) | (d[off+1] << 12) | (d[off+2] << 4) | (d[off+3] >> 4);
		size_t header = ((d[off+3] & 15) << 9) | (d[off+4] << 1) | (d[off+5] >> 7);
		if(header < 7 || header > d.size() - off || body > MAX_BYTES || updated.count(id)) { if(diagnostics) fprintf(stderr, "EPG MOT: invalid header/body length or duplicate transport_id=%u\n", id); return false; }
		// Validate header parameters and reject unsupported compression/CA.
		for(size_t p = off + 7; p < off + header;) {
			unsigned field = d[p++], pli = field >> 6, param = field & 63;
			size_t n = pli == 0 ? 0 : pli == 1 ? 1 : pli == 2 ? 4 : 0;
			if(pli == 3) {
				if(p >= off + header) return false;
				unsigned length = d[p++]; n = length & 127;
				if(length & 128) { if(p >= off + header) return false; n = (n << 8) | d[p++]; }
			}
			if(n > off + header - p) { if(diagnostics) fprintf(stderr, "EPG MOT: truncated header parameter 0x%02x\n", param); return false; }
			if(param == 0x11 || param == 0x23) { if(diagnostics) fprintf(stderr, "EPG MOT: unsupported %s for transport_id=%u\n", param == 0x11 ? "compression" : "conditional access", id); return false; }
			p += n;
		}
		Object obj;
		obj.expected = body; obj.type = (d[off+5] & 0x7e) >> 1; obj.subtype = ((d[off+5] & 1) << 8) | d[off+6];
		if(diagnostics) fprintf(stderr, "EPG MOT: directory entry transport_id=%u type=%u subtype=%u body=%zu\n", id, obj.type, obj.subtype, body);
		obj.header.assign(d.begin() + off, d.begin() + off + header);
		std::map<unsigned, Object>::const_iterator old = objects.find(id);
		if(old != objects.end() && old->second.header == obj.header)
			obj = old->second;
		updated[id] = obj; off += header;
	}
	if(off != d.size()) { if(diagnostics) fprintf(stderr, "EPG MOT: trailing directory bytes=%zu\n", d.size() - off); return false; }
	objects.swap(updated);
	std::vector<unsigned> ids;
	for(std::map<unsigned, Object>::const_iterator i = objects.begin(); i != objects.end(); ++i) ids.push_back(i->first);
	observer.DirectoryChanged(ids);
	return true;
}
void MOTCarousel::PacketDataGroup(const std::vector<uint8_t>& g) {
	if(g.size() < 11 || (g[0] & 0x70) != 0x70) { if(diagnostics) fprintf(stderr, "EPG MOT: rejected incomplete group header or missing flags\n"); ++errors; return; }
	unsigned type = g[0] & 15;
	if(type != 4 && type != 6) { if(diagnostics) fprintf(stderr, "EPG MOT: ignored unsupported data group type=%u\n", type); return; }
	size_t pos = 2 + ((g[0] & 0x80) ? 2 : 0);
	if(g.size() - pos < 7) { if(diagnostics) fprintf(stderr, "EPG MOT: rejected truncated session header\n"); ++errors; return; }
	bool last = g[pos] & 0x80; unsigned seg = ((g[pos] & 0x7f) << 8) | g[pos+1];
	unsigned flags = g[pos+2]; size_t access = flags & 15; pos += 3;
	if(!(flags & 0x10) || access < 2 || g.size() - pos < access + 4) { if(diagnostics) fprintf(stderr, "EPG MOT: rejected invalid transport ID or access length\n"); ++errors; return; }
	unsigned id = g[pos] << 8 | g[pos+1]; pos += access;
	size_t len = ((g[pos] & 31) << 8) | g[pos+1]; pos += 2;
	if(len != g.size() - pos - 2) { if(diagnostics) fprintf(stderr, "EPG MOT: rejected segment length=%zu available=%zu\n", len, g.size() - pos - 2); ++errors; return; }
	if(diagnostics) fprintf(stderr, "EPG MOT: type=%u transport_id=%u segment=%u last=%u bytes=%zu\n", type, id, seg, last ? 1 : 0, len);
	if(type == 6) {
		if(directory_id != static_cast<int>(id)) { directory = Segments(); directory_id = id; }
		if(!directory.Add(seg, last, &g[pos], len)) { if(diagnostics) fprintf(stderr, "EPG MOT: rejected conflicting or oversized directory segment\n"); directory = Segments(); ++errors; return; }
		if(directory.Complete()) {
			if(!Directory(directory.Join())) { if(diagnostics) fprintf(stderr, "EPG MOT: rejected invalid, compressed, encrypted or unsupported directory\n"); ++errors; }
			directory = Segments();
		}
	} else {
		std::map<unsigned, Object>::iterator i = objects.find(id);
		if(i == objects.end()) { if(diagnostics) fprintf(stderr, "EPG MOT: ignored body transport_id=%u absent from directory\n", id); return; }
		Object& o = i->second;
		if(!o.body.Add(seg, last, &g[pos], len)) { if(diagnostics) fprintf(stderr, "EPG MOT: rejected conflicting or oversized body segment\n"); o.body = Segments(); ++errors; return; }
		if(o.body.Complete()) {
			std::vector<uint8_t> body = o.body.Join(); o.body = Segments();
			if(body.size() != o.expected) { if(diagnostics) fprintf(stderr, "EPG MOT: rejected body length=%zu expected=%zu\n", body.size(), o.expected); ++errors; return; }
			if(body != o.delivered) {
				if(diagnostics) fprintf(stderr, "EPG MOT: completed transport_id=%u type=%u subtype=%u bytes=%zu\n", id, o.type, o.subtype, body.size());
				o.delivered = body;
				CarouselObject result = {id, o.type, o.subtype, body}; observer.ObjectReady(result);
			}
		}
	}
}
