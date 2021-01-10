(function(){
    var query = window.location.search.replace(/^\?/, '').split('&').map(function(v){
        var s = v.split('=');
        var r = {};
        r[s[0]] = s.slice(1).join('=');
        return r;
    }).reduce(function(a, b){
        return a.assign(b);
    });

    var expectedCallsign;
    if (query.callsign) expectedCallsign = query.callsign;
    var expectedLocator;
    if (query.locator) expectedLocator = query.locator;

    var protocol = window.location.protocol.match(/https/) ? 'wss' : 'ws';

    var href = window.location.href;
    var index = href.lastIndexOf('/');
    if (index > 0) {
        href = href.substr(0, index + 1);
    }
    href = href.split("://")[1];
    href = protocol + "://" + href;
    if (!href.endsWith('/')) {
        href += '/';
    }
    var ws_url = href + "ws/";

    var map;
    var markers = {};
    var rectangles = {};
    var receiverMarker;
    var updateQueue = [];

    // reasonable default; will be overriden by server
    var retention_time = 2 * 60 * 60 * 1000;
    var strokeOpacity = 0.8;
    var fillOpacity = 0.35;

    var colorKeys = {};
    var colorScale = chroma.scale(['red', 'blue', 'green']).mode('hsl');
    var getColor = function(id){
        if (!id) return "#000000";
        if (!colorKeys[id]) {
            var keys = Object.keys(colorKeys);
            keys.push(id);
            keys.sort(function(a, b) {
                var pa = parseFloat(a);
                var pb = parseFloat(b);
                if (isNaN(pa) || isNaN(pb)) return a.localeCompare(b);
                return pa - pb;
            });
            var colors = colorScale.colors(keys.length);
            colorKeys = {};
            keys.forEach(function(key, index) {
                colorKeys[key] = colors[index];
            });
            reColor();
            updateLegend();
        }
        return colorKeys[id];
    }

    // when the color palette changes, update all grid squares with new color
    var reColor = function() {
        $.each(rectangles, function(_, r) {
            var color = getColor(colorAccessor(r));
            //r.setOptions({
            r.setStyle({
                color: color,
                fillColor: color
            });
        });
    }

    var colorMode = 'byband';
    var colorAccessor = function(r) {
        switch (colorMode) {
            case 'byband':
                return r.band;
            case 'bymode':
                return r.mode;
        }
    };

    var updateLegend = function() {
        var lis = $.map(colorKeys, function(value, key) {
            return '<li class="square"><span class="illustration" style="background-color:' + chroma(value).alpha(fillOpacity) + ';border-color:' + chroma(value).alpha(strokeOpacity) + ';"></span>' + key + '</li>';
        });
        $(".openwebrx-map-legend .content").html('<ul>' + lis.join('') + '</ul>');
    }

    var processUpdates = function(updates) {
        if (!map) {  //typeof(AprsMarker) == 'undefined') {
            updateQueue = updateQueue.concat(updates);
            return;
        }
        updates.forEach(function(update){
            switch (update.location.type) {
                case 'latlon':
                    var pos = new L.LatLng(update.location.lat, update.location.lon);
                    var marker;
                    var aprsOptions = {}
                    if (update.location.symbol) {
                        aprsOptions.symbol = update.location.symbol;
                        aprsOptions.course = update.location.course;
                        aprsOptions.speed = update.location.speed;
                    }
                    if (markers[update.callsign]) {
                        marker = markers[update.callsign];
			if(pos.equals(marker.getLatLng())) {
			    console.log("update: position unchanged");
			} else {
			    console.log("update: appending new position to path");
			    marker.path.addLatLng(pos);
			}
                    } else {
                        marker = new L.marker(pos);
			poly = L.polyline(pos, { opacity: 0.5, color: '#3388ff' });
			marker.path = poly
                        marker.on('click', function(){
                            showMarkerInfoWindow(update.callsign, pos);
                        });
                        markers[update.callsign] = marker;
                        marker.addTo(map);
			poly.addTo(map);
                    }
                    var icon = new AprsIcon(aprsOptions);
                    marker.setIcon(icon);
                    marker.setLatLng(pos);
                    marker.title = update.callsign;
                    marker.lastseen = update.lastseen;
                    marker.mode = update.mode;
                    marker.band = update.band;
                    marker.comment = update.location.comment;
		    marker.opacity = getScale(update.lastseen);
                    marker.update(); // necessary?

                    // TODO the trim should happen on the server side
                    if (expectedCallsign && expectedCallsign == update.callsign.trim()) {
                        map.panTo(pos);
                        showMarkerInfoWindow(update.callsign, pos);
                        expectedCallsign = false;
                    }

                    if (infowindow && infowindow.callsign && infowindow.callsign == update.callsign.trim()) {
                        showMarkerInfoWindow(infowindow.callsign, pos);
                    }
                break;
                case 'locator':
                    var loc = update.location.locator;
                    var lat = (loc.charCodeAt(1) - 65 - 9) * 10 + Number(loc[3]);
                    var lon = (loc.charCodeAt(0) - 65 - 9) * 20 + Number(loc[2]) * 2;
                    var center = new L.LatLng(lat + .5, lon + 1);
                    var rectangle;
                    // the accessor is designed to work on the rectangle... but it should work on the update object, too
                    var color = getColor(colorAccessor(update));
                    if (rectangles[update.callsign]) {
                        rectangle = rectangles[update.callsign];
			rectangle.setBounds([[lat, lon], [lat+1, lon+2]]);
                    } else {
                        //rectangle = new google.maps.Rectangle();
			rectangle = L.rectangle([[lat, lon], [lat+1, lon+2]]);
                        rectangle.on('click', function(){
                            showLocatorInfoWindow(this.locator, this.center);
                        });
                        rectangles[update.callsign] = rectangle;
                    }
		    opt = getRectangleOpacityOptions(update.lastseen);
		    opt.color = color;
		    opt.weight = 2;
		    opt.fillColor = color;
		    rectangle.setStyle(opt);
		    rectangle.addTo(map);
		    /*
                    rectangle.setOptions($.extend({
                        strokeColor: color,
                        strokeWeight: 2,
                        fillColor: color,
                        map: map,
                        bounds:{
                            north: lat,
                            south: lat + 1,
                            west: lon,
                            east: lon + 2
                        }
                    }, getRectangleOpacityOptions(update.lastseen) ));
		    */
                    rectangle.lastseen = update.lastseen;
                    rectangle.locator = update.location.locator;
                    rectangle.mode = update.mode;
                    rectangle.band = update.band;
                    rectangle.center = center;

                    if (expectedLocator && expectedLocator == update.location.locator) {
                        map.panTo(center);
                        showLocatorInfoWindow(expectedLocator, center);
                        expectedLocator = false;
                    }

                    if (infowindow && infowindow.locator && infowindow.locator == update.location.locator) {
                        showLocatorInfoWindow(infowindow.locator, center);
                    }
                break;
            }
        });
    };

    var clearMap = function(){
        var reset = function(callsign, item) { item.setMap(); };
        $.each(markers, reset);
        $.each(rectangles, reset);
        receiverMarker.setMap();
        markers = {};
        rectangles = {};
    };

    var reconnect_timeout = false;

    var connect = function(){
        var ws = new WebSocket(ws_url);
        ws.onopen = function(){
            ws.send("SERVER DE CLIENT client=map.js type=map");
            reconnect_timeout = false
        };

        ws.onmessage = function(e){
            if (typeof e.data != 'string') {
                console.error("unsupported binary data on websocket; ignoring");
                return
            }
            if (e.data.substr(0, 16) == "CLIENT DE SERVER") {
                console.log("Server acknowledged WebSocket connection.");
                return
            }
            try {
                var json = JSON.parse(e.data);
		console.log(e.data);
                switch (json.type) {
                    case "config":
                        var config = json.value;
                        var receiverPos = {
                            lat: config.receiver_gps.lat,
                            lng: config.receiver_gps.lon
                        };
                        if (!map) { // $.getScript("https://unpkg.com/leaflet@1.7.1/dist/leaflet.js").done(function(){
                            // map = new L.Map($('.openwebrx-map')[0], {
                            map = new L.Map("openwebrx-map", { //$('.openwebrx-map')[0], {
                                center: new L.LatLng(receiverPos['lat'], receiverPos['lng']),
                                zoom: 8,
                                layers: new L.TileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
                                     attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                   })
                            });
                            function updateTerminator(t) { t.setTime(); }
                            map.addControl(new L.Control.Fullscreen({
                                title: {
                                    'false': 'View Fullscreen',
                                    'true': 'Exit Fullscreen'
                                }
                            }));
                            L.control.scale({metric: true, imperial: false, position: "bottomright"}).addTo(map);

                            L.Control.MapLegend = L.Control.extend({
                                onAdd: function(map) {
				    var div = L.DomUtil.create('div','openwebrx-map-legend');
				    div.innerHTML = `
    <h3>Colors</h3>
        <select id="openwebrx-map-colormode">
            <option value="byband" selected="selected">By Band</option>
            <option value="bymode">By Mode</option>
        </select>
        <div class="content"></div>
    `;
				    L.DomEvent.disableClickPropagation(div);
				    L.DomEvent.on(div, "change", function(e){
					colorMode = e.target.value;
					colorKeys = {};
					reColor();
					updateLegend();
				    });
				    return div;
                                }
                            });

		   	    L.Control.mapLegend = function(opts) {
				return new L.Control.MapLegend(opts);
		   	    }
                            L.Control.mapLegend({position: 'bottomleft'}).addTo(map);

                            var t = L.terminator();
                            t.addTo(map);
                            setInterval(function(){updateTerminator(t)}, 500);

                            if (!receiverMarker) {
				// for testing
				// options = { symbol: { table: '/', index: 18 }, course: 310 };
				// var myIcon = new AprsIcon(options);
				// normal:
				var myIcon = L.icon({
					iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
					iconSize: [20,33],
					iconAnchor: [11,33],
					popupAnchor: [0,-28],
				});
                                receiverMarker = new L.Marker( new L.LatLng(receiverPos['lat'], receiverPos['lng']), {icon: myIcon} );
                                receiverMarker.on('click', function() {
                                    showReceiverInfoWindow(receiverMarker);
                                });
                            }
                            //receiverMarker.setLatLng(receiverPos['lat'], receiverPos['lng']);
                            receiverMarker.config = config;
                            receiverMarker.titel = config['receiver_name'];
                            map.addLayer(receiverMarker);
                        } else {
                            //receiverMarker.setLatLng(receiverPos['lat'], receiverPos['lng']);
                            receiverMarker.config = config;
                            receiverMarker.titel = config['receiver_name'];
                            receiverMarker.update();
                        }
                        retention_time = config.map_position_retention_time * 1000;
                    break;
                    case "update":
                        processUpdates(json.value);
                    break;
                    case 'receiver_details':
                        $('#webrx-top-container').header().setDetails(json['value']);
                    break;
                    default:
                        console.warn('received message of unknown type: ' + json['type']);
                }
            } catch (e) {
                // don't lose exception
                console.error(e);
            }
        };
        ws.onclose = function(){
            clearMap();
            if (reconnect_timeout) {
                // max value: roundabout 8 and a half minutes
                reconnect_timeout = Math.min(reconnect_timeout * 2, 512000);
            } else {
                // initial value: 1s
                reconnect_timeout = 1000;
            }
            setTimeout(connect, reconnect_timeout);
        };

        window.onbeforeunload = function() { //http://stackoverflow.com/questions/4812686/closing-websocket-correctly-html5-javascript
            ws.onclose = function () {};
            ws.close();
        };

        /*
        ws.onerror = function(){
            console.info("websocket error");
        };
        */
    };

    connect();

    var getInfoWindow = function() {
        if (!infowindow) {
            infowindow = L.popup( { offset: L.point(0, -0) });
	    infowindow.on('remove', function() {
		    delete infowindow.locator;
		    delete infowindow.callsign;
	    });
            /*
            infowindow = new google.maps.InfoWindow();
            google.maps.event.addListener(infowindow, 'closeclick', function() {
                delete infowindow.locator;
                delete infowindow.callsign;
            });
            */
        }
        return infowindow;
    }

    var infowindow;
    var showLocatorInfoWindow = function(locator, pos) {
        var infowindow = getInfoWindow();
        infowindow.locator = locator;
        var inLocator = $.map(rectangles, function(r, callsign) {
            return {callsign: callsign, locator: r.locator, lastseen: r.lastseen, mode: r.mode, band: r.band}
        }).filter(function(d) {
            return d.locator == locator;
        }).sort(function(a, b){
            return b.lastseen - a.lastseen;
        });
        infowindow.setContent(
            '<h3>Locator: ' + locator + '</h3>' +
            '<div>Active Callsigns:</div>' +
            '<ul>' +
                inLocator.map(function(i){
                    var timestring = moment(i.lastseen).fromNow();
                    var message = i.callsign + ' (' + timestring + ' using ' + i.mode;
                    if (i.band) message += ' on ' + i.band;
                    message += ')';
                    return '<li>' + message + '</li>'
                }).join("") +
            '</ul>'
        );
        //infowindow.setPosition(pos);
        infowindow.setLatLng([pos['lat'], pos['lng']]);  //Position(pos);
        infowindow.openOn(map);
    };

    var showMarkerInfoWindow = function(callsign, pos) {
        var infowindow = getInfoWindow();
        infowindow.callsign = callsign;
        var marker = markers[callsign];
        var timestring = moment(marker.lastseen).fromNow();
        var commentString = "";
        if (marker.comment) {
            commentString = '<div>' + marker.comment + '</div>';
        }
        infowindow.setContent(
            '<h3>' + callsign + '</h3>' +
            '<div>' + timestring + ' using ' + marker.mode + ( marker.band ? ' on ' + marker.band : '' ) + '</div>' +
            commentString
        );
	if (infowindow._source) infowindow._source.unbindPopup();
        marker.bindPopup(infowindow).openPopup();
    }

    var showReceiverInfoWindow = function(marker) {
        var infowindow = getInfoWindow()
        infowindow.setContent(
            '<h3>' + marker.config['receiver_name'] + '</h3>' +
            '<div>Receiver location</div>'
        );
	if (infowindow._source) infowindow._source.unbindPopup();
        marker.bindPopup(infowindow).openPopup();
    }

    var getScale = function(lastseen) {
        var age = new Date().getTime() - lastseen;
        var scale = 1;
        if (age >= retention_time / 2) {
            scale = (retention_time - age) / (retention_time / 2);
        }
        return Math.max(0, Math.min(1, scale));
    };

    var getRectangleOpacityOptions = function(lastseen) {
        var scale = getScale(lastseen);
        return {
            //strokeOpacity: strokeOpacity * scale,
            opacity: strokeOpacity * scale,
            fillOpacity: fillOpacity * scale
        };
    };

    // fade out / remove positions after time
    setInterval(function(){
        var now = new Date().getTime();
        $.each(rectangles, function(callsign, m) {
            var age = now - m.lastseen;
            if (age > retention_time) {
                delete rectangles[callsign];
                // TODO: m.setMap();
                return;
            }
	    m.setStyle({opacity: getScale(m.lastseen)});
            // TODO m.setOptions(getRectangleOpacityOptions(m.lastseen));
        });
        $.each(markers, function(callsign, m) {
            var age = now - m.lastseen;
            if (age > retention_time) {
                delete markers[callsign];
                // TODO: m.setMap();
                return;
            }
	    m.setOpacity(getScale(m.lastseen));
            // TODO m.setOptions(getMarkerOpacityOptions(m.lastseen));
        });
    }, 10 /* TODO: set back up to 1000 */);

})();
