/* Copyright (C) 2026 DABlin contributors. GPL-3.0-or-later. */
#ifndef EPG_VIEW_MODEL_H_
#define EPG_VIEW_MODEL_H_
#include "spi_decoder.h"
#include <map>
#include <string>
#include <vector>

struct EPGStation {
	std::string bearer, name;
	std::map<std::string, std::vector<SPIProgramme> > days;
};
std::vector<EPGStation> BuildEPGStations(const std::vector<SPIService>& services, const std::vector<SPIProgramme>& programmes);
std::string EPGLocalDay(int64_t utc);
std::string EPGLocalTime(int64_t utc, const std::string& selected_day);
#endif
