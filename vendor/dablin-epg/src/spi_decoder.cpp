/* Copyright (C) 2026 DABlin contributors. GPL-3.0-or-later. */
#include "spi_decoder.h"
#include <cstdio>
#include <map>
#include <algorithm>
#include <stdexcept>

namespace {
bool StartBefore(const SPIProgramme& a, const SPIProgramme& b) { return a.start_utc < b.start_utc; }
struct Node { unsigned tag; std::vector<uint8_t> value; };
bool Parse(const std::vector<uint8_t>& bytes, std::vector<Node>& nodes) {
	size_t p = 0;
	while(p < bytes.size()) {
		if(bytes.size() - p < 2 || nodes.size() >= 100000) return false;
		Node node; node.tag = bytes[p++]; size_t len = bytes[p++];
		if(len >= 254) {
			size_t n = len == 254 ? 2 : 3; if(bytes.size() - p < n) return false;
			len = 0; while(n--) len = (len << 8) | bytes[p++];
		}
		if(len > bytes.size() - p) return false;
		node.value.assign(bytes.begin() + p, bytes.begin() + p + len); p += len;
		nodes.push_back(node);
	}
	return true;
}
const Node* Find(const std::vector<Node>& v, unsigned tag) {
	for(size_t i = 0; i < v.size(); ++i) if(v[i].tag == tag) return &v[i];
	return NULL;
}
bool Children(const Node* n, std::vector<Node>& result) { return n && Parse(n->value, result); }
std::string Text(const Node* n) {
	if(!n) return "";
	std::vector<Node> children;
	if(!Children(n, children)) throw std::runtime_error("invalid text element");
	const Node* text = Find(children, 1);
	if(!text) return "";
	const std::vector<uint8_t>& b = text->value;
	for(size_t i = 0; i < b.size();) {
		unsigned c = b[i++];
		if(c < 0x80) {
			if(c < 0x20 && c != 9 && c != 10 && c != 13) throw std::runtime_error("unsupported text token");
			continue;
		}
		unsigned count = c >= 0xc2 && c <= 0xdf ? 1 : c >= 0xe0 && c <= 0xef ? 2 : c >= 0xf0 && c <= 0xf4 ? 3 : 0;
		if(!count || b.size() - i < count) throw std::runtime_error("invalid UTF-8");
		unsigned code = c & (0x7f >> count);
		for(unsigned j = 0; j < count; ++j) {
			if((b[i] & 0xc0) != 0x80) throw std::runtime_error("invalid UTF-8");
			code = (code << 6) | (b[i++] & 0x3f);
		}
		if((count == 2 && code < 0x800) || (count == 3 && code < 0x10000) ||
			(code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) throw std::runtime_error("invalid UTF-8");
	}
	return std::string(b.begin(), b.end());
}
std::string Bearer(const Node* n) {
	if(!n) return "";
	const std::vector<uint8_t>& b = n->value;
	// Only explicit ensemble, 16-bit programme SID and no X-PAD are supported.
	if(b.size() != 6 || (b[0] & 0x70) != 0x40) return "";
	char out[40];
	std::snprintf(out, sizeof(out), "dab:%x%02x.%02x%02x.%02x%02x.%x", b[2] >> 4, b[1], b[2], b[3], b[4], b[5], b[0] & 15);
	return out;
}
bool Time(const Node* n, int64_t& utc) {
	if(!n || n->value.size() < 4) return false;
	const std::vector<uint8_t>& b = n->value;
	uint32_t x = (static_cast<uint32_t>(b[0]) << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
	unsigned mjd = (x >> 14) & 0x1ffff, hour = (x >> 6) & 31, minute = x & 63;
	bool offset = x & 0x1000, long_form = x & 0x800;
	size_t need = 4 + (long_form ? 2 : 0) + (offset ? 1 : 0);
	if(b.size() != need || hour >= 24 || minute >= 60 || mjd > 99999) return false;
	unsigned second = 0;
	if(long_form) { second = b[4] >> 2; if(second >= 60 || (b[4] & 3) || b[5]) return false; }
	if(offset && (b[need-1] & 31) > 24) return false;
	utc = (static_cast<int64_t>(mjd) - 40587) * 86400 + hour * 3600 + minute * 60 + second;
	// ETSI encodes UTC directly; LTO describes presentation and does not change it.
	return true;
}
bool Programme(const Node& node, SPIProgramme& p, std::string& reason) {
	std::vector<Node> n; if(!Parse(node.value, n)) { reason = "malformed programme TLV"; return false; }
	p.name = Text(Find(n, 0x12)); if(p.name.empty()) p.name = Text(Find(n, 0x11));
	if(p.name.empty()) p.name = Text(Find(n, 0x10));
	const Node* media = Find(n, 0x13); std::vector<Node> m;
	if(media) { if(!Children(media, m)) { reason = "malformed media description"; return false; } p.short_description = Text(Find(m, 0x1a)); p.long_description = Text(Find(m, 0x1b)); }
	std::vector<Node> loc; if(!Children(Find(n, 0x19), loc)) { reason = "missing or malformed location"; return false; }
	std::vector<Node> time; if(!Children(Find(loc, 0x2c), time) || !Time(Find(time, 0x80), p.start_utc)) { reason = "missing, invalid or unsupported start time"; return false; }
	const Node* duration = Find(time, 0x81);
	if(!duration || duration->value.size() != 2) { reason = "missing or unsupported duration"; return false; }
	p.end_utc = p.start_utc + (duration->value[0] << 8 | duration->value[1]);
	std::vector<Node> bearer; if(!Children(Find(loc, 0x2d), bearer)) { reason = "missing or malformed bearer"; return false; }
	p.bearer = Bearer(Find(bearer, 0x80));
	if(p.name.empty()) { reason = "missing programme name"; return false; }
	if(p.bearer.empty()) { reason = "unsupported DAB bearer"; return false; }
	return true;
}
bool ServiceInfo(const Node& root, std::vector<SPIService>& output) {
	std::vector<Node> r; if(!Parse(root.value, r) || Find(r, 0x04)) return false;
	for(size_t i=0; i<r.size(); ++i) if(r[i].tag == 0x26) {
		std::vector<Node> ensemble; if(!Parse(r[i].value, ensemble)) return false;
		for(size_t j=0; j<ensemble.size(); ++j) if(ensemble[j].tag == 0x28) {
			std::vector<Node> service, id; if(!Parse(ensemble[j].value, service) || !Children(Find(service, 0x29), id)) return false;
			SPIService s; s.name = Text(Find(service, 0x12)); if(s.name.empty()) s.name = Text(Find(service, 0x11));
			s.bearer = Bearer(Find(id, 0x80)); if(s.name.empty() || s.bearer.empty()) return false; output.push_back(s);
		}
	}
	return true;
}
bool ProgrammeInfo(const Node& root, std::vector<SPIProgramme>& output, std::string& reason) {
	std::vector<Node> r; if(!Parse(root.value, r)) { reason = "malformed PI root"; return false; }
	if(Find(r, 0x04) || Find(r, 0x05)) { reason = "unsupported token table or default bearer"; return false; }
	for(size_t i=0; i<r.size(); ++i) if(r[i].tag == 0x21) {
		std::vector<Node> schedule; if(!Parse(r[i].value, schedule)) { reason = "malformed schedule"; return false; }
		for(size_t j=0; j<schedule.size(); ++j) if(schedule[j].tag == 0x1c) {
			SPIProgramme p; if(!Programme(schedule[j], p, reason)) return false; output.push_back(p);
		}
	}
	return true;
}
}
void SPIDecoder::Rebuild() {
	services.clear();
	for(std::map<unsigned, std::vector<SPIService> >::const_iterator i = services_by_object.begin(); i != services_by_object.end(); ++i)
		services.insert(services.end(), i->second.begin(), i->second.end());
	programmes.clear();
	for(std::map<unsigned, std::vector<SPIProgramme> >::const_iterator i = programmes_by_object.begin(); i != programmes_by_object.end(); ++i)
		programmes.insert(programmes.end(), i->second.begin(), i->second.end());
	std::stable_sort(programmes.begin(), programmes.end(), StartBefore);
}
void SPIDecoder::DirectoryChanged(const std::vector<unsigned>& ids) {
	for(std::map<unsigned, std::vector<SPIProgramme> >::iterator i = programmes_by_object.begin(); i != programmes_by_object.end();) {
		if(std::find(ids.begin(), ids.end(), i->first) == ids.end()) programmes_by_object.erase(i++); else ++i;
	}
	for(std::map<unsigned, std::vector<SPIService> >::iterator i = services_by_object.begin(); i != services_by_object.end();) {
		if(std::find(ids.begin(), ids.end(), i->first) == ids.end()) services_by_object.erase(i++); else ++i;
	}
	Rebuild();
}
void SPIDecoder::ObjectReady(const CarouselObject& object) {
	// ETSI SPI binary Service Information and Programme Information only.
	if(object.content_type != 7 || (object.content_subtype != 0 && object.content_subtype != 1)) { if(diagnostics) fprintf(stderr, "EPG SPI: ignored transport_id=%u unsupported type=%u subtype=%u\n", object.transport_id, object.content_type, object.content_subtype); return; }
	std::vector<Node> root;
	if(!Parse(object.body, root) || root.size() != 1) { if(diagnostics) fprintf(stderr, "EPG SPI: rejected transport_id=%u invalid top-level TLV\n", object.transport_id); ++errors; return; }
	try {
	if(object.content_subtype == 0 && root[0].tag == 3) {
		std::vector<SPIService> decoded; if(!ServiceInfo(root[0], decoded)) { if(diagnostics) fprintf(stderr, "EPG SPI: rejected SI transport_id=%u malformed or unsupported SI data\n", object.transport_id); ++errors; return; }
		services_by_object[object.transport_id] = decoded;
		Rebuild();
		++si_objects;
		if(diagnostics) fprintf(stderr, "EPG SPI: SI transport_id=%u services=%zu\n", object.transport_id, decoded.size());
	} else if(object.content_subtype == 1 && root[0].tag == 2) {
		std::vector<SPIProgramme> decoded; std::string reason;
		if(!ProgrammeInfo(root[0], decoded, reason)) { if(diagnostics) fprintf(stderr, "EPG SPI: rejected PI transport_id=%u: %s\n", object.transport_id, reason.c_str()); ++errors; return; }
		programmes_by_object[object.transport_id] = decoded;
		Rebuild();
		++pi_objects;
		if(diagnostics) fprintf(stderr, "EPG SPI: PI transport_id=%u programmes=%zu total=%zu\n", object.transport_id, decoded.size(), programmes.size());
	} else { if(diagnostics) fprintf(stderr, "EPG SPI: rejected transport_id=%u mismatched root tag=%u subtype=%u\n", object.transport_id, root[0].tag, object.content_subtype); ++errors; }
	} catch(const std::runtime_error& e) { if(diagnostics) fprintf(stderr, "EPG SPI: rejected transport_id=%u %s\n", object.transport_id, e.what()); ++errors; }
}
