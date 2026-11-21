/* Copyright (C) 2026 DABlin contributors. GPL-3.0-or-later. */
#ifndef SPI_DECODER_H_
#define SPI_DECODER_H_
#include "mot_carousel.h"
#include <cstdint>
#include <string>
#include <map>
#include <vector>
struct SPIProgramme {
	std::string name, short_description, long_description, bearer;
	int64_t start_utc, end_utc;
};
struct SPIService {
	std::string name, bearer;
};
class SPIDecoder : public CarouselObserver {
public:
	explicit SPIDecoder(bool diagnostics = false) : errors(0), si_objects(0), pi_objects(0), diagnostics(diagnostics) {}
	void ObjectReady(const CarouselObject& object);
	void DirectoryChanged(const std::vector<unsigned>& ids);
	std::vector<SPIProgramme> programmes;
	std::vector<SPIService> services;
	unsigned errors, si_objects, pi_objects;
private:
	bool diagnostics;
	std::map<unsigned, std::vector<SPIProgramme> > programmes_by_object;
	std::map<unsigned, std::vector<SPIService> > services_by_object;
	void Rebuild();
};
#endif
