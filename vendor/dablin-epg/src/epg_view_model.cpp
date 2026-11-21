/* Copyright (C) 2026 DABlin contributors. GPL-3.0-or-later. */
#include "epg_view_model.h"
#include <algorithm>
#include <ctime>
#include <set>
#include <tuple>

namespace {
bool Local(int64_t utc, std::tm& result) {
	time_t t = static_cast<time_t>(utc);
	return static_cast<int64_t>(t) == utc && localtime_r(&t, &result);
}
bool Before(const SPIProgramme& a, const SPIProgramme& b) { return a.start_utc < b.start_utc; }
}
std::string EPGLocalDay(int64_t utc) {
	std::tm t; char buf[16];
	return Local(utc,t) && std::strftime(buf,sizeof(buf),"%Y-%m-%d",&t) ? buf : "";
}
std::string EPGLocalTime(int64_t utc, const std::string& selected_day) {
	std::tm t; char buf[64];
	if(!Local(utc,t)) return "?";
	const char* format = EPGLocalDay(utc) == selected_day ? "%H:%M %Z" : "%Y-%m-%d %H:%M %Z";
	return std::strftime(buf,sizeof(buf),format,&t) ? buf : "?";
}
std::vector<EPGStation> BuildEPGStations(const std::vector<SPIService>& services, const std::vector<SPIProgramme>& programmes) {
	std::map<std::string, EPGStation> stations;
	std::map<std::string, std::string> names;
	for(size_t i=0; i<services.size(); ++i) if(!services[i].bearer.empty()) names[services[i].bearer]=services[i].name;
	typedef std::tuple<std::string,int64_t,int64_t,std::string,std::string,std::string> Key;
	std::set<Key> seen;
	for(size_t i=0; i<programmes.size(); ++i) {
		const SPIProgramme& p=programmes[i];
		if(p.bearer.empty() || p.end_utc<=p.start_utc || !seen.insert(Key(p.bearer,p.start_utc,p.end_utc,p.name,p.short_description,p.long_description)).second) continue;
		std::string first=EPGLocalDay(p.start_utc), last=EPGLocalDay(p.end_utc-1);
		if(first.empty() || last.empty()) continue;
		EPGStation& station=stations[p.bearer]; station.bearer=p.bearer;
		station.name=names.count(p.bearer) && !names[p.bearer].empty() ? names[p.bearer] : p.bearer;
		station.days[first].push_back(p);
		if(last!=first) station.days[last].push_back(p);
	}
	std::vector<EPGStation> result;
	for(std::map<std::string, EPGStation>::iterator it=stations.begin(); it!=stations.end(); ++it) {
		for(std::map<std::string,std::vector<SPIProgramme> >::iterator d=it->second.days.begin(); d!=it->second.days.end(); ++d)
			std::stable_sort(d->second.begin(),d->second.end(),Before);
		result.push_back(it->second);
	}
	return result;
}
