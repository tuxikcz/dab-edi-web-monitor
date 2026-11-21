/* Copyright (C) 2026 DABlin contributors. GPL-3.0-or-later. */
#include "dablin_gtk_epg.h"
#include <ctime>

DABlinGTKEPGWindow::DABlinGTKEPGWindow() : layout(Gtk::ORIENTATION_VERTICAL, 6), controls(Gtk::ORIENTATION_HORIZONTAL, 6), updating(false) {
	set_title("EPG"); set_default_size(720, 520); set_border_width(10);
	add(layout);
	station_label.set_text_with_mnemonic("_Station:"); station_label.set_mnemonic_widget(station);
	day_label.set_text_with_mnemonic("_Day:"); day_label.set_mnemonic_widget(day);
	controls.pack_start(station_label, Gtk::PACK_SHRINK); controls.pack_start(station, Gtk::PACK_EXPAND_WIDGET);
	controls.pack_start(day_label, Gtk::PACK_SHRINK); controls.pack_start(day, Gtk::PACK_SHRINK);
	layout.pack_start(controls, Gtk::PACK_SHRINK);
	status.set_text("Waiting for programme information..."); status.set_halign(Gtk::ALIGN_START);
	layout.pack_start(status, Gtk::PACK_SHRINK);
	rows=Gtk::ListStore::create(cols); list.set_model(rows);
	list.get_accessible()->set_name("Programme list");
	Gtk::CellRendererText* start_renderer=Gtk::manage(new Gtk::CellRendererText());
	Gtk::TreeViewColumn* start_col=Gtk::manage(new Gtk::TreeViewColumn("Start", *start_renderer));
	start_col->add_attribute(start_renderer->property_text(), cols.start); start_col->add_attribute(start_renderer->property_weight(), cols.weight); list.append_column(*start_col);
	Gtk::CellRendererText* end_renderer=Gtk::manage(new Gtk::CellRendererText());
	Gtk::TreeViewColumn* end_col=Gtk::manage(new Gtk::TreeViewColumn("End", *end_renderer));
	end_col->add_attribute(end_renderer->property_text(), cols.end); end_col->add_attribute(end_renderer->property_weight(), cols.weight); list.append_column(*end_col);
	Gtk::CellRendererText* name_renderer=Gtk::manage(new Gtk::CellRendererText());
	Gtk::TreeViewColumn* name_col=Gtk::manage(new Gtk::TreeViewColumn("Programme", *name_renderer));
	name_col->add_attribute(name_renderer->property_text(), cols.name); name_col->add_attribute(name_renderer->property_weight(), cols.weight); name_col->set_expand(true); list.append_column(*name_col);
	list_scroll.set_policy(Gtk::POLICY_AUTOMATIC, Gtk::POLICY_AUTOMATIC); list_scroll.add(list); list_scroll.set_vexpand(true);
	layout.pack_start(list_scroll, Gtk::PACK_EXPAND_WIDGET);
	detail.set_editable(false); detail.set_cursor_visible(false); detail.set_wrap_mode(Gtk::WRAP_WORD_CHAR);
	detail.get_accessible()->set_name("Programme description");
	detail_scroll.set_policy(Gtk::POLICY_AUTOMATIC, Gtk::POLICY_AUTOMATIC); detail_scroll.set_min_content_height(110); detail_scroll.add(detail);
	layout.pack_start(detail_scroll, Gtk::PACK_SHRINK);
	station.signal_changed().connect(sigc::mem_fun(*this,&DABlinGTKEPGWindow::UpdateDays));
	day.signal_changed().connect(sigc::mem_fun(*this,&DABlinGTKEPGWindow::UpdateProgrammes));
	list.get_selection()->signal_changed().connect(sigc::mem_fun(*this,&DABlinGTKEPGWindow::UpdateDetail));
	signal_delete_event().connect(sigc::mem_fun(*this,&DABlinGTKEPGWindow::HideWindow));
	Glib::signal_timeout().connect_seconds(sigc::mem_fun(*this,&DABlinGTKEPGWindow::Tick),30);
	show_all_children();
}
bool DABlinGTKEPGWindow::HideWindow(GdkEventAny*) { hide(); return true; }
void DABlinGTKEPGWindow::SetStatus(const std::string& text) { status.set_text(text); }
void DABlinGTKEPGWindow::Clear() { stations.clear(); UpdateStations(); status.set_text("Waiting for programme information..."); }
void DABlinGTKEPGWindow::SetData(const std::vector<SPIService>& services,const std::vector<SPIProgramme>& programmes) {
	SetStations(BuildEPGStations(services,programmes));
}
void DABlinGTKEPGWindow::SetStations(const std::vector<EPGStation>& value) {
	stations=value; UpdateStations();
	status.set_text(stations.empty() ? "No supported programme information received." : "Programme information received. Times are local.");
}
void DABlinGTKEPGWindow::UpdateStations() {
	std::string selected=station.get_active_id(); updating=true; station.remove_all();
	for(size_t i=0;i<stations.size();++i) station.append(stations[i].bearer,stations[i].name);
	if(!selected.empty()) station.set_active_id(selected);
	if(station.get_active_row_number()<0 && !stations.empty()) station.set_active(0);
	updating=false; UpdateDays();
}
void DABlinGTKEPGWindow::UpdateDays() {
	if(updating) return;
	std::string selected=day.get_active_id(), bearer=station.get_active_id(); updating=true; day.remove_all();
	for(size_t i=0;i<stations.size();++i) if(stations[i].bearer==bearer)
		for(std::map<std::string,std::vector<SPIProgramme> >::const_iterator d=stations[i].days.begin(); d!=stations[i].days.end(); ++d) day.append(d->first,d->first);
	if(!selected.empty()) day.set_active_id(selected);
	if(day.get_active_row_number()<0) day.set_active_id(EPGLocalDay(std::time(NULL)));
	if(day.get_active_row_number()<0 && !stations.empty()) day.set_active(0);
	updating=false; UpdateProgrammes();
}
void DABlinGTKEPGWindow::UpdateProgrammes() {
	if(updating) return;
	gint64 selected=-1; Glib::ustring selected_name;
	Gtk::TreeModel::iterator old=list.get_selection()->get_selected();
	if(old) { selected=(*old)[cols.start_epoch]; selected_name=(*old)[cols.name]; }
	rows->clear(); std::string bearer=station.get_active_id(), date=day.get_active_id(); int64_t now=std::time(NULL);
	Gtk::TreeModel::iterator current;
	for(size_t i=0;i<stations.size();++i) if(stations[i].bearer==bearer) {
		std::map<std::string,std::vector<SPIProgramme> >::const_iterator found=stations[i].days.find(date);
		if(found==stations[i].days.end()) break;
		for(size_t j=0;j<found->second.size();++j) {
			const SPIProgramme& p=found->second[j]; Gtk::TreeModel::Row row=*(rows->append());
			row[cols.start]=EPGLocalTime(p.start_utc,date); row[cols.end]=EPGLocalTime(p.end_utc,date); row[cols.name]=p.name;
			std::string description=p.short_description;
			if(!p.long_description.empty() && p.long_description!=p.short_description) { if(!description.empty()) description+="\n\n"; description+=p.long_description; }
			row[cols.description]=description; row[cols.start_epoch]=p.start_utc; row[cols.weight]=(p.start_utc<=now && now<p.end_utc) ? 700 : 400;
			if(p.start_utc<=now && now<p.end_utc) current=row;
			if(selected==p.start_utc && selected_name==p.name) list.get_selection()->select(row);
		}
		break;
	}
	if(!list.get_selection()->get_selected() && current) {
		list.get_selection()->select(current);
		list.scroll_to_row(rows->get_path(current));
	}
	UpdateDetail();
}
void DABlinGTKEPGWindow::UpdateDetail() {
	Gtk::TreeModel::iterator it=list.get_selection()->get_selected();
	if(it) { Glib::ustring name=(*it)[cols.name], description=(*it)[cols.description]; detail.get_buffer()->set_text(name + (description.empty() ? "" : "\n\n" + description)); }
	else detail.get_buffer()->set_text("");
}
bool DABlinGTKEPGWindow::Tick() { if(get_visible()) UpdateProgrammes(); return true; }
