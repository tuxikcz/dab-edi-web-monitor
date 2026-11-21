/*
    DABlin - capital DAB experience
    Copyright (C) 2019-2024 Stefan Pöschel

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

#ifndef EDI_PLAYER_H_
#define EDI_PLAYER_H_

#include "ensemble_player.h"


// --- EDIPlayer -----------------------------------------------------------------
class EDIPlayer : public EnsemblePlayer {
private:
	int previous_sequence;
	void DecodeFrame(const uint8_t *edi_frame);
public:
	EDIPlayer(AudioOutputType audio_output_type, bool disable_int_catch_up, EnsemblePlayerObserver *observer)
		: EnsemblePlayer(audio_output_type, disable_int_catch_up, observer), previous_sequence(-1) {}
	~EDIPlayer() {}
};

#endif /* EDI_PLAYER_H_ */
