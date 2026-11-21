/* Copyright (C) 2026 DABlin contributors. GPL-3.0-or-later. */
#ifndef DABLIN_GTK_EPG_H_
#define DABLIN_GTK_EPG_H_
#include "epg_view_model.h"
#include <gtkmm.h>
class DABlinGTKEPGWindow : public Gtk::Window {
public:
	DABlinGTKEPGWindow();
	void SetData(const std::vector<SPIService>& services, const std::vector<SPIProgramme>& programmes);
	void SetStations(const std::vector<EPGStation>& value);
	void SetStatus(const std::string& text);
	void Clear();
private:
	class Columns : public Gtk::TreeModelColumnRecord {
	public:
		Gtk::TreeModelColumn<Glib::ustring> start, end, name, description;
		Gtk::TreeModelColumn<int> weight;
		Gtk::TreeModelColumn<gint64> start_epoch;
		Columns() { add(start); add(end); add(name); add(description); add(weight); add(start_epoch); }
	};
	void UpdateStations();
	void UpdateDays();
	void UpdateProgrammes();
	void UpdateDetail();
	bool Tick();
	bool HideWindow(GdkEventAny*);
	Gtk::Box layout, controls;
	Gtk::Label station_label, day_label, status;
	Gtk::ComboBoxText station, day;
	Gtk::ScrolledWindow list_scroll, detail_scroll;
	Gtk::TreeView list;
	Gtk::TextView detail;
	Columns cols;
	Glib::RefPtr<Gtk::ListStore> rows;
	std::vector<EPGStation> stations;
	bool updating;
};
#endif
