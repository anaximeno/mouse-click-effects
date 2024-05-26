/* applet.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
'use strict';

const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const SignalManager = imports.misc.signalManager;
const { Atspi, GLib, Gio } = imports.gi;
const { ClickAnimationFactory } = require("./clickAnimations.js");
const { Debouncer } = require("./helpers.js");


const LOCALE_DIR = GLib.get_home_dir() + "/.local/share/locale";
const UUID = "mouse-click-effects@anaximeno";

Gettext.bindtextdomain(UUID, LOCALE_DIR);


function _(text) {
	let localized = Gettext.dgettext(UUID, text);
	return localized != text ? localized : window._(text);
}

const ClickType = {
    LEFT: "left_click",
    MIDDLE: "middle_click",
    RIGHT: "right_click",
};


class MouseClickEffects {
	constructor(metadata) {
		this.metadata = metadata;
		this.app_icons_dir = `${metadata.path}/../icons`;
		this.settings = this._setup_settings(this.metadata.uuid);
		this.data_dir = this._init_data_dir(this.metadata.uuid);
		this.enabled = false;

		Atspi.init();

		this.listener = Atspi.EventListener.new(this._click_event.bind(this));
		this.signals = new SignalManager.SignalManager(null);
		this.signals.connect(global.screen, 'in-fullscreen-changed', this.on_fullscreen_changed, this);

		this.display_click = (new Debouncer()).debounce(this._animate_click.bind(this), 2);
		this.colored_icon_store = {};
		this.update_colored_icons();
	}

    _init_data_dir(uuid) {
		let data_dir = `${GLib.get_user_cache_dir()}/${uuid}`;

		if (GLib.mkdir_with_parents(`${data_dir}/icons`, 0o777) < 0)
			throw new Error(`Failed to create cache dir at ${data_dir}`);

		return data_dir;
	}

	_setup_settings(uuid) {
		let settings = new Settings.AppletSettings(this, uuid);
		let bindings = [
			{
				key: "animation-time",
				value: "animation_time",
				cb: null,
			},
			{
				key: "icon-mode",
				value: "icon_mode",
				cb: this.on_property_updated,
			},
			{
				key: "size",
				value: "size",
				cb: null,
			},
			{
				key: "left-click-effect-enabled",
				value: "left_click_effect_enabled",
				cb: null,
			},
			{
				key: "right-click-effect-enabled",
				value: "right_click_effect_enabled",
				cb: null,
			},
			{
				key: "middle-click-effect-enabled",
				value: "middle_click_effect_enabled",
				cb: null,
			},
			{
				key: "left-click-color",
				value: "left_click_color",
				cb: this.update_colored_icons,
			},
			{
				key: "middle-click-color",
				value: "middle_click_color",
				cb: this.update_colored_icons,
			},
			{
				key: "right-click-color",
				value: "right_click_color",
				cb: this.update_colored_icons,
			},
			{
				key: "general-opacity",
				value: "general_opacity",
				cb: null,
			},
			{
				key: "animation-mode",
				value: "animation_mode",
				cb: null,
			},
			{
				key: "deactivate-on-fullscreen",
				value: "deactivate_on_fullscreen",
				cb: null,
			},
		]

        bindings.forEach(
			b => settings.bind(
                b.key, b.value, b.cb ? (...args) => b.cb.call(this, ...args) : null,
            )
		);

        return settings;
	}

	enable() {
		this.set_active(true);
	}

	disable() {
		this.destroy();
	}

	on_effects_enabled_updated(event) {
		thib.on_property_updated(event);
	}

	on_fullscreen_changed() {
        if (this.deactivate_on_fullscreen) {
            const monitor = global.screen.get_current_monitor();
            const monitorIsInFullscreen = global.screen.get_monitor_in_fullscreen(monitor);
			this.set_active(!monitorIsInFullscreen);
		}
	}

    get_colored_icon(mode, click_type, color) {
        const name = `${mode}_${click_type}_${color}`;

		if (this.colored_icon_store[name]) {
			return this.colored_icon_store[name];
		}

		const path = `${this.data_dir}/icons/${name}.svg`;

        if (GLib.file_test(path, GLib.FileTest.IS_REGULAR)) {
			this.colored_icon_store[name] = Gio.icon_new_for_string(path);
			return this.colored_icon_store[name];
		}

        return null;
	}

	destroy() {
		this.signals.disconnectAllSignals();
		this.set_active(false);
		this.settings.finalize();
	}

	update_colored_icons() {
		this._create_colored_icon_data(ClickType.LEFT, this.left_click_color);
		this._create_colored_icon_data(ClickType.MIDDLE, this.middle_click_color);
		this._create_colored_icon_data(ClickType.RIGHT, this.right_click_color);
	}

	set_active(enabled) {
		this.enabled = enabled;
		this.listener.deregister('mouse');

		if (enabled) {
			this.update_colored_icons();
			this.listener.register('mouse');
		}
	}

	_create_colored_icon_data(click_type, color) {
		if (this.get_colored_icon(this.icon_mode, click_type, color))
			return;

        let source = Gio.File.new_for_path(`${this.app_icons_dir}/${this.icon_mode}.svg`);
		let [l_success, contents] = source.load_contents(null);
		contents = imports.byteArray.toString(contents);

		// Replace to new color
		contents = contents.replace('fill="#000000"', `fill="${color}"`);

		// Save content to cache dir
        const name = `${this.icon_mode}_${click_type}_${color}`;
		let dest = Gio.File.new_for_path(`${this.data_dir}/icons/${name}.svg`);

		if (!dest.query_exists(null)) {
			dest.create(Gio.FileCreateFlags.NONE, null);
		}

		let [r_success, tag] = dest.replace_contents(contents, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
	}

	_animate_click(click_type, color) {
		let icon = this.get_colored_icon(this.icon_mode, click_type, color);

		if (icon) {
			const options = {
				opacity: this.general_opacity,
				icon_size: this.size,
				timeout: this.animation_time,
			};

			ClickAnimationFactory.createForMode(this.animation_mode).animateClick(icon, options);
		}
	}

	_click_event(event) {
		switch (event.type) {
			case 'mouse:button:1p':
				if (this.left_click_effect_enabled)
					this.display_click(ClickType.LEFT, this.left_click_color);
				break;
			case 'mouse:button:2p':
				if (this.middle_click_effect_enabled)
					this.display_click(ClickType.MIDDLE, this.middle_click_color);
				break;
			case 'mouse:button:3p':
				if (this.right_click_effect_enabled)
					this.display_click(ClickType.RIGHT, this.right_click_color);
				break;
		}
	}
}


let extension = null;

function enable() {
    extension.enable();
}

function disable() {
    extension.disable();
    extension = null;
}

function init(metadata) {
    if (!extension) extension = new MouseClickEffects(metadata);
}