from datetime import datetime, timezone
from owrx.map import Map, LocatorLocation
import re
from owrx.metrics import Metrics, CounterMetric
from owrx.pskreporter import PskReporter
from owrx.parser import Parser
from owrx.audio import AudioChopperProfile
from abc import ABC, ABCMeta, abstractmethod
from owrx.config import Config

import logging

logger = logging.getLogger(__name__)


class WsjtProfile(AudioChopperProfile, metaclass=ABCMeta):
    def decoding_depth(self):
        pm = Config.get()
        mode = self.getMode().lower()
        # mode-specific setting?
        if "wsjt_decoding_depths" in pm and mode in pm["wsjt_decoding_depths"]:
            return pm["wsjt_decoding_depths"][mode]
        # return global default
        if "wsjt_decoding_depth" in pm:
            return pm["wsjt_decoding_depth"]
        # default when no setting is provided
        return 3

    def getTimestampFormat(self):
        if self.getInterval() < 60:
            return "%H%M%S"
        return "%H%M"

    def getFileTimestampFormat(self):
        return "%y%m%d_" + self.getTimestampFormat()

    @abstractmethod
    def getMode(self):
        pass


class Ft8Profile(WsjtProfile):
    def getInterval(self):
        return 15

    def decoder_commandline(self, file):
        return ["jt9", "--ft8", "-d", str(self.decoding_depth()), file]

    def getMode(self):
        return "FT8"


class WsprProfile(WsjtProfile):
    def getInterval(self):
        return 120

    def decoder_commandline(self, file):
        cmd = ["wsprd"]
        if self.decoding_depth() > 1:
            cmd += ["-d"]
        cmd += [file]
        return cmd

    def getMode(self):
        return "WSPR"


class Jt65Profile(WsjtProfile):
    def getInterval(self):
        return 60

    def decoder_commandline(self, file):
        return ["jt9", "--jt65", "-d", str(self.decoding_depth()), file]

    def getMode(self):
        return "JT65"


class Jt9Profile(WsjtProfile):
    def getInterval(self):
        return 60

    def decoder_commandline(self, file):
        return ["jt9", "--jt9", "-d", str(self.decoding_depth()), file]

    def getMode(self):
        return "JT9"


class Ft4Profile(WsjtProfile):
    def getInterval(self):
        return 7.5

    def decoder_commandline(self, file):
        return ["jt9", "--ft4", "-d", str(self.decoding_depth()), file]

    def getMode(self):
        return "FT4"


class Fst4Profile(WsjtProfile):
    availableIntervals = [15, 30, 60,  120, 300, 900, 1800]

    def __init__(self, interval):
        self.interval = interval

    def getInterval(self):
        return self.interval

    def decoder_commandline(self, file):
        return ["jt9", "--fst4", "-p", str(self.interval), "-d", str(self.decoding_depth()), file]

    def getMode(self):
        return "FST4"

    @staticmethod
    def getEnabledProfiles():
        config = Config.get()
        profiles = config["fst4_enabled_intervals"] if "fst4_enabled_intervals" in config else []
        return [Fst4Profile(i) for i in profiles if i in Fst4Profile.availableIntervals]


class Fst4wProfile(WsjtProfile):
    availableIntervals = [120, 300, 900, 1800]

    def __init__(self, interval):
        self.interval = interval

    def getInterval(self):
        return self.interval

    def decoder_commandline(self, file):
        return ["jt9", "--fst4w", "-p", str(self.interval), "-d", str(self.decoding_depth()), file]

    def getMode(self):
        return "FST4W"

    @staticmethod
    def getEnabledProfiles():
        config = Config.get()
        profiles = config["fst4w_enabled_intervals"] if "fst4w_enabled_intervals" in config else []
        return [Fst4wProfile(i) for i in profiles if i in Fst4wProfile.availableIntervals]


class WsjtParser(Parser):
    def parse(self, messages):
        for data in messages:
            try:
                profile, freq, raw_msg = data
                self.setDialFrequency(freq)
                msg = raw_msg.decode().rstrip()
                # known debug messages we know to skip
                if msg.startswith("<DecodeFinished>"):
                    return
                if msg.startswith(" EOF on input file"):
                    return

                mode = profile.getMode()
                if mode == "WSPR":
                    decoder = WsprDecoder(profile)
                else:
                    decoder = Jt9Decoder(profile)
                out = decoder.parse(msg, freq)
                out["mode"] = mode

                self.pushDecode(mode)
                if "callsign" in out and "locator" in out:
                    Map.getSharedInstance().updateLocation(
                        out["callsign"], LocatorLocation(out["locator"]), mode, self.band
                    )
                    PskReporter.getSharedInstance().spot(out)

                self.handler.write_wsjt_message(out)
            except (ValueError, IndexError):
                logger.exception("error while parsing wsjt message")

    def pushDecode(self, mode):
        metrics = Metrics.getSharedInstance()
        band = "unknown"
        if self.band is not None:
            band = self.band.getName()
        if band is None:
            band = "unknown"

        if mode is None:
            mode = "unknown"

        name = "wsjt.decodes.{band}.{mode}".format(band=band, mode=mode)
        metric = metrics.getMetric(name)
        if metric is None:
            metric = CounterMetric()
            metrics.addMetric(name, metric)

        metric.inc()


class Decoder(ABC):
    locator_pattern = re.compile(".*\\s([A-Z0-9/]{2,})(\\sR)?\\s([A-R]{2}[0-9]{2})$")

    def __init__(self, profile):
        self.profile = profile

    def parse_timestamp(self, instring):
        dateformat = self.profile.getTimestampFormat()
        remain = instring[len(dateformat) + 1:]
        try:
            ts = datetime.strptime(instring[0:len(dateformat)], dateformat)
            return remain, int(
                datetime.combine(datetime.utcnow().date(), ts.time()).replace(tzinfo=timezone.utc).timestamp() * 1000
            )
        except ValueError:
            return remain, None

    @abstractmethod
    def parse(self, msg, dial_freq):
        pass

    def parseMessage(self, msg):
        m = Decoder.locator_pattern.match(msg)
        if m is None:
            return {}
        # this is a valid locator in theory, but it's somewhere in the arctic ocean, near the north pole, so it's very
        # likely this just means roger roger goodbye.
        if m.group(3) == "RR73":
            return {"callsign": m.group(1)}
        return {"callsign": m.group(1), "locator": m.group(3)}


class Jt9Decoder(Decoder):
    def parse(self, msg, dial_freq):
        # ft8 sample
        # '222100 -15 -0.0  508 ~  CQ EA7MJ IM66'
        # jt65 sample
        # '2352  -7  0.4 1801 #  R0WAS R2ABM KO85'
        # '0003  -4  0.4 1762 #  CQ R2ABM KO85'
        # fst4 sample
        # '**** -23  0.6 3023 `  <...> <...> R 591631 BI53PV'
        msg, timestamp = self.parse_timestamp(msg)
        wsjt_msg = msg[17:53].strip()
        result = {
            "timestamp": timestamp,
            "db": float(msg[0:3]),
            "dt": float(msg[4:8]),
            "freq": dial_freq + int(msg[9:13]),
            "msg": wsjt_msg,
        }
        result.update(self.parseMessage(wsjt_msg))
        return result


class WsprDecoder(Decoder):
    wspr_splitter_pattern = re.compile("([A-Z0-9/]*)\\s([A-R]{2}[0-9]{2})\\s([0-9]+)")

    def parse(self, msg, dial_freq):
        # wspr sample
        # '2600 -24  0.4   0.001492 -1  G8AXA JO01 33'
        # '0052 -29  2.6   0.001486  0  G02CWT IO92 23'
        msg, timestamp = self.parse_timestamp(msg)
        wsjt_msg = msg[24:].strip()
        result = {
            "timestamp": timestamp,
            "db": float(msg[0:3]),
            "dt": float(msg[4:8]),
            "freq": dial_freq + int(float(msg[10:20]) * 1e6),
            "drift": int(msg[20:23]),
            "msg": wsjt_msg,
        }
        result.update(self.parseMessage(wsjt_msg))
        return result

    def parseMessage(self, msg):
        m = WsprDecoder.wspr_splitter_pattern.match(msg)
        if m is None:
            return {}
        return {"callsign": m.group(1), "locator": m.group(2)}
