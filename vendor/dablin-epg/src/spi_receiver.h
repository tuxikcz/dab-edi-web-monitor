/* Copyright (C) 2026 DABlin contributors. GPL-3.0-or-later. */
#ifndef SPI_RECEIVER_H_
#define SPI_RECEIVER_H_
#include "spi_fic.h"
#include "packet_data.h"
#include "mot_carousel.h"
#include "spi_decoder.h"
#include <string>
class SPIReceiverObserver {
public:
	virtual ~SPIReceiverObserver() {}
	virtual void SPIUpdated(const std::vector<SPIService>& services, const std::vector<SPIProgramme>& programmes) = 0;
	virtual void SPIStatus(const std::string& status) = 0;
	virtual void SPIReset() = 0;
};
class SPIReceiver {
public:
	explicit SPIReceiver(const std::string& output, bool diagnostics = false, SPIReceiverObserver* observer = NULL);
	~SPIReceiver();
	void ProcessFIC(const uint8_t* data, size_t len);
	void Subchannel(unsigned id, const uint8_t* data, size_t len);
	void Discontinuity();
	void Reset();
	bool Exported() const { return exported && !write_error; }
private:
	bool Export();
	std::string output;
	bool diagnostics;
	size_t msc_frames;
	SPIFIC fic;
	SPIComponent current;
	bool active, exported, write_error;
	unsigned exported_pi;
	unsigned exported_si;
	unsigned generation;
	SPIReceiverObserver* observer;
	SPIDecoder* spi;
	MOTCarousel* mot;
	PacketDataDecoder* packet;
};
#endif
