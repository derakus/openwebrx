var AprsIcon = L.DivIcon.extend({
    options: {
        className: "dummyAprsIcon",
        iconSize: [24, 24],
	popupAnchor: [0,-6],
    },
    createIcon: function(oldIcon) {
        var realicon = L.DivIcon.prototype.createIcon.call(this, oldIcon);
	var icon = document.createElement('div');
	realicon.appendChild(icon);
        icon.position = 'absolute';
        icon.cursor = 'pointer';
        icon.style.backgroundColor = "#ff0000";
        icon.style.cursor = "crosshair";
        icon.style.width = '24px';
        icon.style.height = '24px';
	if(this.options.course) {
                if (this.options.course> 180) {
                        transform = 'scalex(-1) rotate(' + (270 - this.options.course) + 'deg)'
                } else {
                        transform = 'rotate(' + (this.options.course - 90) + 'deg)';
                }
                icon.style[L.DomUtil.TRANSFORM] += transform;
                icon.style[L.DomUtil.TRANSFORM + 'Origin'] = '50% 50%';
        }


        var overlay = this.overlay = document.createElement('div');
        overlay.style.width = '24px';
        overlay.style.height = '24px';
        overlay.style.background = 'url(aprs-symbols/aprs-symbols-24-2@2x.png)';
        overlay.style['background-size'] = '384px 144px';
        overlay.style.display = 'none';
        icon.appendChild(overlay);
        L.DomUtil.addClass(icon, "test");

        var tableId = this.options.symbol.table === '/' ? 0 : 1;
        icon.style.background = 'url(aprs-symbols/aprs-symbols-24-' + tableId + '@2x.png)';
        icon.style['background-size'] = '384px 144px';
        icon.style['background-position-x'] = -(this.options.symbol.index % 16) * 24 + 'px';
        icon.style['background-position-y'] = -Math.floor(this.options.symbol.index / 16) * 24 + 'px';

        if (this.options.symbol.table !== '/' && this.options.symbol.table !== '\\') {
            overlay.style.display = 'block';
            overlay.style['background-position-x'] = -(this.options.symbol.tableindex % 16) * 24 + 'px';
            overlay.style['background-position-y'] = -Math.floor(this.options.symbol.tableindex / 16) * 24 + 'px';
        } else {
            overlay.style.display = 'none';
        }
        if (this.options.opacity) {
            icon.style.opacity = this.options.opacity;
        } else {
            icon.style.opacity = null;
        }   
        return realicon;
    }
});

//// old
/*
function AprsMarker() {}

AprsMarker.prototype = new google.maps.OverlayView();

AprsMarker.prototype.draw = function() {
	var div = this.div;
	var overlay = this.overlay;
	if (!div || !overlay) return;

    if (this.symbol) {
        var tableId = this.symbol.table === '/' ? 0 : 1;
        div.style.background = 'url(aprs-symbols/aprs-symbols-24-' + tableId + '@2x.png)';
        div.style['background-size'] = '384px 144px';
        div.style['background-position-x'] = -(this.symbol.index % 16) * 24 + 'px';
        div.style['background-position-y'] = -Math.floor(this.symbol.index / 16) * 24 + 'px';
    }

    if (this.course) {
        if (this.course > 180) {
            div.style.transform = 'scalex(-1) rotate(' + (270 - this.course) + 'deg)'
        } else {
            div.style.transform = 'rotate(' + (this.course - 90) + 'deg)';
        }
    } else {
        div.style.transform = null;
    }

    if (this.symbol.table !== '/' && this.symbol.table !== '\\') {
        overlay.style.display = 'block';
        overlay.style['background-position-x'] = -(this.symbol.tableindex % 16) * 24 + 'px';
        overlay.style['background-position-y'] = -Math.floor(this.symbol.tableindex / 16) * 24 + 'px';
    } else {
        overlay.style.display = 'none';
    }

    if (this.opacity) {
        div.style.opacity = this.opacity;
    } else {
        div.style.opacity = null;
    }

	var point = this.getProjection().fromLatLngToDivPixel(this.position);

	if (point) {
		div.style.left = point.x - 12 + 'px';
		div.style.top = point.y - 12 + 'px';
	}
};

AprsMarker.prototype.setOptions = function(options) {
    google.maps.OverlayView.prototype.setOptions.apply(this, arguments);
    this.draw();
};

AprsMarker.prototype.onAdd = function() {
    var div = this.div = document.createElement('div');

    div.style.position = 'absolute';
    div.style.cursor = 'pointer';
    div.style.width = '24px';
    div.style.height = '24px';

    var overlay = this.overlay = document.createElement('div');
    overlay.style.width = '24px';
    overlay.style.height = '24px';
    overlay.style.background = 'url(aprs-symbols/aprs-symbols-24-2@2x.png)';
    overlay.style['background-size'] = '384px 144px';
    overlay.style.display = 'none';

    div.appendChild(overlay);

	var self = this;
    google.maps.event.addDomListener(div, "click", function(event) {
        event.stopPropagation();
        google.maps.event.trigger(self, "click", event);
    });

    var panes = this.getPanes();
    panes.overlayImage.appendChild(div);
};

AprsMarker.prototype.remove = function() {
	if (this.div) {
		this.div.parentNode.removeChild(this.div);
		this.div = null;
	}
};

AprsMarker.prototype.getAnchorPoint = function() {
    return new google.maps.Point(0, -12);
};*/
