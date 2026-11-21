/* Copyright (C) 2026 DABlin contributors. GPL-3.0-or-later. */
#ifndef MOT_CAROUSEL_H_
#define MOT_CAROUSEL_H_
#include "packet_data.h"
#include <map>
#include <vector>
#include <cstdint>

struct CarouselObject {
	unsigned transport_id, content_type, content_subtype;
	std::vector<uint8_t> body;
};
class CarouselObserver {
public:
	virtual ~CarouselObserver() {}
	virtual void ObjectReady(const CarouselObject& object) = 0;
	virtual void DirectoryChanged(const std::vector<unsigned>& /*ids*/) {}
};
class MOTCarousel : public PacketDataObserver {
public:
	explicit MOTCarousel(CarouselObserver& observer, bool diagnostics = false) : observer(observer), errors(0), directory_id(-1), diagnostics(diagnostics) {}
	void PacketDataGroup(const std::vector<uint8_t>& group);
	unsigned Errors() const { return errors; }
	bool Complete() const;
	void Report() const;
private:
	struct Segments {
		std::map<unsigned, std::vector<uint8_t> > chunks;
		int last;
		size_t size;
		Segments() : last(-1), size(0) {}
		bool Add(unsigned number, bool final, const uint8_t* data, size_t len);
		bool Complete() const;
		std::vector<uint8_t> Join() const;
	};
	struct Object {
		unsigned type, subtype;
		size_t expected;
		std::vector<uint8_t> header;
		Segments body;
		std::vector<uint8_t> delivered;
		Object() : type(0), subtype(0), expected(0) {}
	};
	bool Directory(const std::vector<uint8_t>& data);
	CarouselObserver& observer;
	unsigned errors;
	int directory_id;
	bool diagnostics;
	Segments directory;
	std::map<unsigned, Object> objects;
};
#endif
