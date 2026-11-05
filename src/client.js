// Browser half of dsh-emotion-profiles.
//
// One Settings section ("情感人格 / Emotion profiles") with five parts:
// the current profile and its valence/arousal, the switch grid (12 built-ins +
// custom), a create form, plugin settings, and the recent RunRecords.
//
// The Host serves everything over a single same-origin route
// (`/emotion-profiles/api`) guarded by the browser connection's admission, so
// this file needs no transport code beyond fetch. It is served verbatim by the
// client-modules bundle route and executed through the lazy CJS module table:
// plain ES2017-ish JS, React from the browser module table, no bundler.
window.__ModuleLoader__.load({
	id: "dsh-emotion-profiles",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var React = require("react");

		var NS = "emotion-profiles";
		var ENDPOINT = "/emotion-profiles/api";
		var tRef = null;

		var dictionaries = {
			zh: {
				section: "情感人格",
				title: "情感人格",
				subtitle: "心情是全局的：切换对所有会话生效",
				current: "当前人格",
				none: "尚未选择",
				valence: "效价",
				arousal: "唤醒",
				halfLife: "半衰期",
				hours: "小时",
				updated: "更新于",
				net: "情感网络",
				netReady: "就绪",
				netMissing: "缺失",
				storage: "活跃记录",
				storageDomain: "storageDomain",
				storageFile: "文件回退",
				switchTitle: "切换人格",
				switchHint: "每个人格保留自己的心情；从未用过的人格从起始状态开始。",
				active: "使用中",
				createTitle: "创建情感人格",
				createHint: "自定义基线、半衰期与说话风格；网络复用所选内置人格的权重。",
				fieldName: "显示名",
				fieldNamePh: "例如：缪斯",
				fieldId: "标识",
				fieldIdHint: "小写字母、数字与连字符",
				fieldDesc: "一句话描述",
				fieldDescPh: "例如：轻快、爱打比方",
				fieldStartV: "起始效价",
				fieldStartA: "起始唤醒",
				fieldBaselineV: "基线效价",
				fieldBaselineA: "基线唤醒",
				fieldHalfLife: "半衰期（小时）",
				fieldNet: "基础网络",
				fieldStyle: "风格提示",
				fieldStylePh: "例如：语气轻快，多用比喻",
				submit: "创建",
				creating: "创建中…",
				created: "已创建并切换",
				switched: "已切换",
				invalidId: "标识不合法或与内置人格重名",
				duplicateId: "该标识已存在",
				settings: "插件设置",
				injection: "注入上下文",
				injectionHint: "关闭后不再向 runtime-context 注入心情描述",
				decay: "衰减强度",
				decayHint: "越大越快回到基线",
				retention: "运行记录保留",
				retentionHint: "按天数清理 _runs/ 下的旧记录",
				days: "天",
				runs: "最近运行",
				runsHint: "每轮结束生成一条 RunRecord，供情感网络读取",
				runTime: "时间",
				runStatus: "状态",
				runErrors: "工具错误",
				runScore: "结果分",
				export: "导出巩固数据",
				exporting: "导出中…",
				on: "开",
				off: "关",
				profiles: "全部人格",
				builtin: "内置",
				custom: "自定义",
				statusCompleted: "完成",
				statusAborted: "中止",
				statusBlocked: "受阻",
				statusFailed: "失败",
				statusEmpty: "空轮",
				loading: "加载中…",
				unavailable: "读取失败",
				retry: "重试",
				refresh: "刷新",
				exported: "已导出",
				exportedCount: "已导出 {n} 条",
				noRuns: "还没有运行记录",
				moodPreview: "注入预览",
				moodEmpty: "注入已关闭",
				warning: "提示",
			},
			en: {
				section: "Emotion profiles",
				title: "Emotion profiles",
				subtitle: "Mood is global: switching applies to every session",
				current: "Current profile",
				none: "Not selected",
				valence: "Valence",
				arousal: "Arousal",
				halfLife: "Half-life",
				hours: "h",
				updated: "Updated",
				net: "Emotion net",
				netReady: "ready",
				netMissing: "missing",
				storage: "Active record",
				storageDomain: "storageDomain",
				storageFile: "file fallback",
				switchTitle: "Switch profile",
				switchHint: "Each profile keeps its own mood; a never-used profile starts from its start state.",
				active: "Active",
				createTitle: "Create a profile",
				createHint: "Custom baseline, half-life and tone; the net reuses the weights of the base profile you pick.",
				fieldName: "Display name",
				fieldNamePh: "e.g. Muse",
				fieldId: "Id",
				fieldIdHint: "lowercase letters, digits and dashes",
				fieldDesc: "One-line description",
				fieldDescPh: "e.g. light, loves metaphors",
				fieldStartV: "Start valence",
				fieldStartA: "Start arousal",
				fieldBaselineV: "Baseline valence",
				fieldBaselineA: "Baseline arousal",
				fieldHalfLife: "Half-life (hours)",
				fieldNet: "Base net",
				fieldStyle: "Style hint",
				fieldStylePh: "e.g. light tone, fond of metaphors",
				submit: "Create",
				creating: "Creating…",
				created: "Created and switched",
				switched: "Switched to",
				invalidId: "Invalid id, or the same as a built-in profile",
				duplicateId: "That id already exists",
				settings: "Plugin settings",
				injection: "Inject context",
				injectionHint: "When off, no mood line is added to runtime-context",
				decay: "Decay strength",
				decayHint: "Higher returns to baseline faster",
				retention: "Run retention",
				retentionHint: "Old records under _runs/ are pruned after this many days",
				days: "days",
				runs: "Recent runs",
				runsHint: "One RunRecord per finished turn, read by the emotion net",
				runTime: "Time",
				runStatus: "Status",
				runErrors: "Tool errors",
				runScore: "Outcome",
				export: "Export consolidation data",
				exporting: "Exporting…",
				on: "on",
				off: "off",
				profiles: "All profiles",
				builtin: "built-in",
				custom: "custom",
				statusCompleted: "completed",
				statusAborted: "aborted",
				statusBlocked: "blocked",
				statusFailed: "failed",
				statusEmpty: "empty",
				loading: "Loading…",
				unavailable: "Could not load",
				retry: "Retry",
				refresh: "Refresh",
				exported: "Exported",
				exportedCount: "Exported {n} records",
				noRuns: "No runs yet",
				moodPreview: "Injection preview",
				moodEmpty: "Injection is off",
				warning: "Warning",
			},
		};

		// ── helpers ─────────────────────────────────────────────────────────
		function h(type, props) {
			var args = [type, props];
			for (var i = 2; i < arguments.length; i++) args.push(arguments[i]);
			return React.createElement.apply(React, args);
		}

		function cls() {
			var out = [];
			for (var i = 0; i < arguments.length; i++) {
				if (arguments[i]) out.push(arguments[i]);
			}
			return out.join(" ");
		}

		function formatTime(ms) {
			if (typeof ms !== "number" || !isFinite(ms) || ms <= 0) return "—";
			try {
				return new Date(ms).toLocaleString();
			} catch (error) {
				return "—";
			}
		}

		function fixed(value, digits) {
			if (typeof value !== "number" || !isFinite(value)) return "—";
			return value.toFixed(typeof digits === "number" ? digits : 2);
		}

		function pct(value) {
			if (typeof value !== "number" || !isFinite(value)) return "0%";
			return Math.round(Math.max(0, Math.min(1, value)) * 100) + "%";
		}

		function translate(key, vars) {
			var t = tRef || function (name) { return name; };
			var text = t(key);
			if (vars) {
				Object.keys(vars).forEach(function (name) {
					text = String(text).split("{" + name + "}").join(String(vars[name]));
				});
			}
			return text;
		}

		function hueFor(valence) {
			var v = typeof valence === "number" && isFinite(valence) ? Math.max(-1, Math.min(1, valence)) : 0;
			return Math.round(220 - ((v + 1) / 2) * 200);
		}

		function statusLabel(status) {
			if (status === "completed") return translate("statusCompleted");
			if (status === "aborted") return translate("statusAborted");
			if (status === "blocked") return translate("statusBlocked");
			if (status === "failed") return translate("statusFailed");
			if (status === "empty") return translate("statusEmpty");
			return String(status || "—");
		}

		function request(action, payload) {
			var init = { credentials: "same-origin", headers: { accept: "application/json" } };
			if (action) {
				init.method = "POST";
				init.headers["content-type"] = "application/json";
				init.body = JSON.stringify(Object.assign({ action: action }, payload || {}));
			}
			return fetch(ENDPOINT, init)
				.then(function (response) {
					return response.json().then(
						function (body) {
							if (!response.ok || body.ok === false) {
								var detail = body && body.error ? body.error : "HTTP " + response.status;
								throw new Error(detail);
							}
							return body;
						},
						function () {
							throw new Error("HTTP " + response.status);
						},
					);
				})
				.catch(function (error) {
					if (error && /Failed to fetch|NetworkError/i.test(String(error.message))) {
						throw new Error(translate("unavailable"));
					}
					throw error;
				});
		}

		// ── styles ──────────────────────────────────────────────────────────
		var CSS_ID = "dsh-emotion-profiles/styles";
		var CSS = [
			".ep-page{display:flex;flex-direction:column;gap:18px;padding:2px 0 40px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.5}",
			".ep-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}",
			".ep-title{margin:0;font-size:18px;font-weight:600;letter-spacing:.01em}",
			".ep-sub{margin:5px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}",
			".ep-block{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:16px 18px}",
			".ep-block-title{margin:0 0 4px;font-size:14px;font-weight:600}",
			".ep-hint{margin:0 0 12px;color:var(--dsw-alias-label-secondary);font-size:12px}",
			".ep-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 12px;font-size:13px;line-height:18px;cursor:pointer;transition:background .12s ease,border-color .12s ease}",
			".ep-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}",
			".ep-btn:disabled{opacity:.5;cursor:default}",
			".ep-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}",
			".ep-btn.primary:hover:not(:disabled){filter:brightness(1.05);background:var(--dsw-alias-brand-primary)}",
			".ep-btn.small{padding:4px 10px;font-size:12px}",
			".ep-current{display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start}",
			".ep-current-main{display:flex;gap:14px;align-items:center;min-width:220px;flex:1 1 220px}",
			".ep-orb{width:56px;height:56px;border-radius:18px;flex:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}",
			".ep-name{font-size:16px;font-weight:600}",
			".ep-name-en{margin-left:8px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:400}",
			".ep-desc{margin-top:3px;color:var(--dsw-alias-label-secondary);font-size:12px}",
			".ep-meters{display:flex;flex-direction:column;gap:9px;flex:1 1 240px;min-width:220px}",
			".ep-meter{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".ep-meter-label{width:52px;flex:none}",
			".ep-meter-track{position:relative;flex:1;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}",
			".ep-meter-fill{position:absolute;top:0;bottom:0;left:0;border-radius:3px;background:linear-gradient(90deg,var(--dsw-alias-brand-primary),var(--dsw-alias-state-warn-primary))}",
			".ep-meter-value{width:44px;text-align:right;font-variant-numeric:tabular-nums}",
			".ep-meta{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:14px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".ep-meta b{font-weight:500;color:var(--dsw-alias-label-primary)}",
			".ep-meta .ep-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px;vertical-align:1px}",
			".ep-mood{margin-top:12px;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:13px}",
			".ep-mood-label{display:block;margin-bottom:3px;color:var(--dsw-alias-label-secondary);font-size:11px;letter-spacing:.04em;text-transform:uppercase}",
			".ep-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:10px}",
			".ep-card{appearance:none;text-align:left;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:10px;padding:10px 12px;cursor:pointer;display:flex;flex-direction:column;gap:2px;transition:border-color .12s ease,background .12s ease}",
			".ep-card:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}",
			".ep-card.active{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}",
			".ep-card:disabled{opacity:.6;cursor:default}",
			".ep-card-top{display:flex;align-items:baseline;justify-content:space-between;gap:6px}",
			".ep-card-name{font-weight:600;font-size:13px}",
			".ep-card-en{color:var(--dsw-alias-label-secondary);font-size:11px}",
			".ep-card-desc{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45;min-height:34px}",
			".ep-badge{align-self:flex-start;margin-top:4px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10px}",
			".ep-badge.active{background:var(--dsw-alias-brand-primary);color:#fff}",
			".ep-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px 14px;margin-top:6px}",
			".ep-field{display:flex;flex-direction:column;gap:5px;min-width:0}",
			".ep-field.wide{grid-column:1/-1}",
			".ep-label{font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".ep-input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:6px 9px;font-size:13px;line-height:18px}",
			".ep-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}",
			".ep-range{width:100%;accent-color:var(--dsw-alias-brand-primary)}",
			".ep-range-value{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
			".ep-actions{grid-column:1/-1;display:flex;align-items:center;gap:12px;margin-top:2px}",
			".ep-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1)}",
			".ep-row:first-of-type{border-top:0;padding-top:2px}",
			".ep-row-text{display:flex;flex-direction:column;gap:2px}",
			".ep-row-title{font-size:13px}",
			".ep-row-hint{color:var(--dsw-alias-label-secondary);font-size:12px}",
			".ep-row-controls{display:flex;align-items:center;gap:10px;flex:none}",
			".ep-switch{appearance:none;position:relative;width:38px;height:22px;border-radius:11px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer;padding:0;transition:background .15s ease}",
			".ep-switch::after{content:\"\";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:left .15s ease}",
			".ep-switch[aria-checked=\"true\"]{background:var(--dsw-alias-brand-primary);border-color:transparent}",
			".ep-switch[aria-checked=\"true\"]::after{left:18px}",
			".ep-num{width:88px}",
			".ep-table{width:100%;border-collapse:collapse;font-size:12px}",
			".ep-table th{text-align:left;font-weight:500;color:var(--dsw-alias-label-secondary);padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}",
			".ep-table td{padding:7px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);font-variant-numeric:tabular-nums}",
			".ep-table tr:last-child td{border-bottom:0}",
			".ep-empty{padding:14px 0;color:var(--dsw-alias-label-secondary);font-size:12px}",
			".ep-err{color:var(--dsw-alias-state-error-primary);font-size:13px}",
			".ep-ok{color:var(--dsw-alias-state-success-primary);font-size:12px}",
			".ep-notice{margin-top:10px;font-size:12px}",
			".ep-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}",
		].join("");

		function ensureStyles() {
			if (typeof document === "undefined") return function () {};
			var existing = document.querySelector('style[data-plugin-css="' + CSS_ID + '"]');
			if (existing) return function () {};
			var tag = document.createElement("style");
			tag.dataset.plugin = "dsh-emotion-profiles";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
			return function () {
				try {
					tag.remove();
				} catch (error) {
					/* already detached */
				}
			};
		}

		// ── small controls ──────────────────────────────────────────────────
		function Toggle(props) {
			return h(
				"button",
				{
					type: "button",
					className: "ep-switch",
					role: "switch",
					"aria-checked": props.checked ? "true" : "false",
					"aria-label": props.label || "",
					disabled: !!props.disabled,
					onClick: function () {
						props.onChange(!props.checked);
					},
				},
			);
		}

		function Meter(props) {
			return h(
				"div",
				{ className: "ep-meter" },
				h("span", { className: "ep-meter-label" }, props.label),
				h("span", { className: "ep-meter-track" }, h("span", { className: "ep-meter-fill", style: { width: pct(props.ratio) } })),
				h("span", { className: "ep-meter-value" }, props.value),
			);
		}

		function Field(props) {
			return h(
				"label",
				{ className: cls("ep-field", props.wide && "wide") },
				h("span", { className: "ep-label" }, props.label),
				props.children,
			);
		}

		function SliderField(props) {
			return h(
				Field,
				{ label: props.label },
				h("input", {
					className: "ep-range",
					type: "range",
					min: props.min,
					max: props.max,
					step: props.step,
					value: props.value,
					onChange: function (event) {
						props.onChange(Number(event.target.value));
					},
				}),
				h("span", { className: "ep-range-value" }, fixed(props.value, 2)),
			);
		}

		// ── current profile ─────────────────────────────────────────────────
		function CurrentBlock(props) {
			var data = props.data;
			var state = data.state || {};
			var profile = props.profile;
			var storageLabel = data.storage && data.storage.mode === "file" ? translate("storageFile") : translate("storageDomain");
			var netId = profile ? profile.net : null;
			var netReady = data.nets && netId ? Boolean(data.nets.available && data.nets.available[netId]) : false;
			var hue = hueFor(state.valence);

			var orb = h("div", {
				className: "ep-orb",
				style: {
					background:
						"linear-gradient(140deg, hsl(" + hue + " 86% 68%), hsl(" + (hue + 32) + " 74% 58%))",
				},
			});

			var identity = h(
				"div",
				null,
				h(
					"div",
					{ className: "ep-name" },
					profile ? profile.name : translate("none"),
					profile ? h("span", { className: "ep-name-en" }, profile.nameEn) : null,
				),
				h("div", { className: "ep-desc" }, profile ? profile.description : ""),
			);

			var meters = h(
				"div",
				{ className: "ep-meters" },
				h(Meter, { label: translate("valence"), ratio: (Number(state.valence) + 1) / 2, value: fixed(state.valence, 2) }),
				h(Meter, { label: translate("arousal"), ratio: Number(state.arousal), value: fixed(state.arousal, 2) }),
			);

			var meta = h(
				"div",
				{ className: "ep-meta" },
				h("span", null, translate("halfLife") + " ", h("b", null, profile ? fixed(profile.halfLifeHours, 1) : "—"), " " + translate("hours")),
				h("span", null, translate("updated") + " ", h("b", null, formatTime(state.updatedAt))),
				h(
					"span",
					null,
					translate("net") + " ",
					h(
						"b",
						null,
						h("span", {
							className: "ep-dot",
							style: { background: netReady ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-warn-primary)" },
						}),
						netReady ? translate("netReady") : translate("netMissing"),
					),
				),
				h("span", null, translate("storage") + " ", h("b", null, storageLabel)),
			);

			var mood = h(
				"div",
				{ className: "ep-mood" },
				h("span", { className: "ep-mood-label" }, translate("moodPreview")),
				data.mood ? data.mood : translate("moodEmpty"),
			);

			return h(
				"section",
				{ className: "ep-block" },
				h("div", { className: "ep-block-title" }, translate("current")),
				h("div", { className: "ep-current" }, h("div", { className: "ep-current-main" }, orb, identity), meters),
				meta,
				mood,
			);
		}

		// ── switch grid ─────────────────────────────────────────────────────
		function ProfileCard(props) {
			var profile = props.profile;
			return h(
				"button",
				{
					type: "button",
					className: cls("ep-card", props.active && "active"),
					disabled: props.disabled,
					onClick: function () {
						if (!props.active) props.onSwitch(profile.id);
					},
				},
				h(
					"span",
					{ className: "ep-card-top" },
					h("span", { className: "ep-card-name" }, profile.name),
					h("span", { className: "ep-card-en" }, profile.nameEn),
				),
				h("span", { className: "ep-card-desc" }, profile.description),
				h(
					"span",
					{ className: cls("ep-badge", props.active && "active") },
					props.active ? translate("active") : profile.builtin ? translate("builtin") : translate("custom"),
				),
			);
		}

		// ── create form ─────────────────────────────────────────────────────
		function slugify(value) {
			return String(value || "")
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "")
				.slice(0, 32);
		}

		function CreateBlock(props) {
			var data = props.data;
			var formState = React.useState({
				name: "",
				id: "",
				idTouched: false,
				description: "",
				style: "",
				startValence: 0,
				startArousal: 0.5,
				baselineValence: 0,
				baselineArousal: 0.5,
				halfLifeHours: 6,
				netProfile: "gentle",
			});
			var form = formState[0];
			var setForm = formState[1];
			var errorState = React.useState("");
			var error = errorState[0];
			var setError = errorState[1];

			function patch(next) {
				setForm(function (previous) {
					return Object.assign({}, previous, next);
				});
			}

			function onName(value) {
				var next = { name: value };
				if (!form.idTouched) {
					var slug = slugify(value);
					if (slug.length >= 2) next.id = slug;
				}
				patch(next);
			}

			function submit(event) {
				if (event && event.preventDefault) event.preventDefault();
				setError("");
				var payload = {
					name: form.name.trim(),
					id: form.id.trim(),
					description: form.description.trim(),
					style: form.style.trim(),
					start: { valence: Number(form.startValence), arousal: Number(form.startArousal) },
					baseline: { valence: Number(form.baselineValence), arousal: Number(form.baselineArousal) },
					halfLifeHours: Number(form.halfLifeHours),
					netProfile: form.netProfile,
				};
				if (payload.name === "") {
					setError(translate("fieldName"));
					return;
				}
				props.onCreate(payload, function (message) {
					if (message) {
						setError(message);
						return;
					}
					setForm(function (previous) {
						return Object.assign({}, previous, {
							name: "",
							id: "",
							idTouched: false,
							description: "",
							style: "",
							startValence: 0,
							startArousal: 0.5,
							baselineValence: 0,
							baselineArousal: 0.5,
						});
					});
				});
			}

			var netOptions = [];
			var seen = {};
			(data.profiles || []).forEach(function (profile) {
				var net = profile.net;
				if (net && !seen[net]) {
					seen[net] = true;
					netOptions.push({ id: net, label: profile.builtin ? profile.name : profile.name + " (" + net + ")" });
				}
			});

			return h(
				"section",
				{ className: "ep-block" },
				h("div", { className: "ep-block-title" }, translate("createTitle")),
				h("p", { className: "ep-hint" }, translate("createHint")),
				h(
					"form",
					{ className: "ep-form", onSubmit: submit },
					h(
						Field,
						{ label: translate("fieldName") },
						h("input", {
							className: "ep-input",
							value: form.name,
							placeholder: translate("fieldNamePh"),
							onChange: function (event) {
								onName(event.target.value);
							},
						}),
					),
					h(
						Field,
						{ label: translate("fieldId") },
						h("input", {
							className: "ep-input ep-mono",
							value: form.id,
							placeholder: "my-muse",
							onChange: function (event) {
								patch({ id: event.target.value, idTouched: true });
							},
						}),
						h("span", { className: "ep-range-value" }, translate("fieldIdHint")),
					),
					h(
						Field,
						{ label: translate("fieldDesc"), wide: true },
						h("input", {
							className: "ep-input",
							value: form.description,
							placeholder: translate("fieldDescPh"),
							onChange: function (event) {
								patch({ description: event.target.value });
							},
						}),
					),
					h(SliderField, {
						label: translate("fieldStartV"),
						min: -1,
						max: 1,
						step: 0.05,
						value: form.startValence,
						onChange: function (value) {
							patch({ startValence: value });
						},
					}),
					h(SliderField, {
						label: translate("fieldStartA"),
						min: 0,
						max: 1,
						step: 0.05,
						value: form.startArousal,
						onChange: function (value) {
							patch({ startArousal: value });
						},
					}),
					h(SliderField, {
						label: translate("fieldBaselineV"),
						min: -1,
						max: 1,
						step: 0.05,
						value: form.baselineValence,
						onChange: function (value) {
							patch({ baselineValence: value });
						},
					}),
					h(SliderField, {
						label: translate("fieldBaselineA"),
						min: 0,
						max: 1,
						step: 0.05,
						value: form.baselineArousal,
						onChange: function (value) {
							patch({ baselineArousal: value });
						},
					}),
					h(
						Field,
						{ label: translate("fieldHalfLife") },
						h("input", {
							className: "ep-input ep-num",
							type: "number",
							min: 0.25,
							max: 168,
							step: 0.25,
							value: form.halfLifeHours,
							onChange: function (event) {
								patch({ halfLifeHours: event.target.value });
							},
						}),
					),
					h(
						Field,
						{ label: translate("fieldNet") },
						h(
							"select",
							{
								className: "ep-input",
								value: form.netProfile,
								onChange: function (event) {
									patch({ netProfile: event.target.value });
								},
							},
							netOptions.map(function (option) {
								return h("option", { key: option.id, value: option.id }, option.label);
							}),
						),
					),
					h(
						Field,
						{ label: translate("fieldStyle"), wide: true },
						h("input", {
							className: "ep-input",
							value: form.style,
							placeholder: translate("fieldStylePh"),
							onChange: function (event) {
								patch({ style: event.target.value });
							},
						}),
					),
					h(
						"div",
						{ className: "ep-actions" },
						h("button", { className: "ep-btn primary", type: "submit", disabled: props.busy }, props.busy ? translate("creating") : translate("submit")),
						error ? h("span", { className: "ep-err" }, error) : null,
					),
				),
			);
		}

		// ── settings ────────────────────────────────────────────────────────
		function SettingsBlock(props) {
			var settings = props.data.settings || {};
			var injection = settings.injection || {};
			var decay = settings.decay || {};
			var runs = settings.runs || {};
			var consolidation = settings.consolidation || {};
			var busy = props.busy;

			return h(
				"section",
				{ className: "ep-block" },
				h("div", { className: "ep-block-title" }, translate("settings")),
				h(
					"div",
					{ className: "ep-row" },
					h(
						"div",
						{ className: "ep-row-text" },
						h("span", { className: "ep-row-title" }, translate("injection")),
						h("span", { className: "ep-row-hint" }, translate("injectionHint")),
					),
					h(
						"div",
						{ className: "ep-row-controls" },
						h(Toggle, {
							checked: injection.enabled !== false,
							label: translate("injection"),
							disabled: busy,
							onChange: function (value) {
								props.onSettings({ injection: { enabled: value } });
							},
						}),
					),
				),
				h(
					"div",
					{ className: "ep-row" },
					h(
						"div",
						{ className: "ep-row-text" },
						h("span", { className: "ep-row-title" }, translate("decay")),
						h("span", { className: "ep-row-hint" }, translate("decayHint")),
					),
					h(
						"div",
						{ className: "ep-row-controls" },
						h("input", {
							className: "ep-input ep-num",
							type: "number",
							min: 0.05,
							max: 20,
							step: 0.05,
							defaultValue: fixed(decay.strength, 2),
							disabled: busy,
							onBlur: function (event) {
								var value = Number(event.target.value);
								if (isFinite(value) && value > 0) props.onSettings({ decay: { strength: value } });
							},
						}),
					),
				),
				h(
					"div",
					{ className: "ep-row" },
					h(
						"div",
						{ className: "ep-row-text" },
						h("span", { className: "ep-row-title" }, translate("retention")),
						h("span", { className: "ep-row-hint" }, translate("retentionHint")),
					),
					h(
						"div",
						{ className: "ep-row-controls" },
						h("input", {
							className: "ep-input ep-num",
							type: "number",
							min: 1,
							max: 3650,
							step: 1,
							defaultValue: String(runs.retentionDays || 30),
							disabled: busy,
							onBlur: function (event) {
								var value = Number(event.target.value);
								if (isFinite(value) && value >= 1) props.onSettings({ runs: { retentionDays: value } });
							},
						}),
						h("span", { className: "ep-row-hint" }, translate("days")),
					),
				),
				h(
					"div",
					{ className: "ep-row" },
					h(
						"div",
						{ className: "ep-row-text" },
						h("span", { className: "ep-row-title" }, translate("export")),
						h("span", { className: "ep-row-hint" }, props.exportNote || translate("runsHint")),
					),
					h(
						"div",
						{ className: "ep-row-controls" },
						h(
							"button",
							{
								type: "button",
								className: "ep-btn small",
								disabled: busy || consolidation.exportEnabled === false,
								onClick: function () {
									props.onExport();
								},
							},
							busy ? translate("exporting") : translate("export"),
						),
					),
				),
			);
		}

		// ── runs ────────────────────────────────────────────────────────────
		function RunsBlock(props) {
			var runs = Array.isArray(props.runs) ? props.runs : [];
			return h(
				"section",
				{ className: "ep-block" },
				h("div", { className: "ep-block-title" }, translate("runs")),
				h("p", { className: "ep-hint" }, translate("runsHint")),
				runs.length === 0
					? h("div", { className: "ep-empty" }, translate("noRuns"))
					: h(
							"table",
							{ className: "ep-table" },
							h("thead", null, h("tr", null, [translate("runTime"), translate("runStatus"), translate("runErrors"), translate("runScore")].map(function (label) {
								return h("th", { key: label }, label);
							}))),
							h(
								"tbody",
								null,
								runs.map(function (run) {
									return h(
										"tr",
										{ key: run.id },
										h("td", null, formatTime(run.endedAt)),
										h("td", null, statusLabel(run.status)),
										h("td", null, String(run.toolErrorCount || 0)),
										h("td", null, fixed(run.outcomeScore, 2)),
									);
								}),
							),
						),
			);
		}

		// ── page ────────────────────────────────────────────────────────────
		function EmotionSettingsPage(props) {
			var stateHook = React.useState({ loading: true, error: "", data: null, busy: false, notice: "", exportNote: "" });
			var current = stateHook[0];
			var setState = stateHook[1];
			var busyRef = React.useRef(false);
			busyRef.current = current.busy;

			function accept(data) {
				setState(function (previous) {
					return {
						loading: false,
						error: "",
						data: data,
						busy: false,
						notice: previous.notice,
						exportNote: previous.exportNote,
					};
				});
			}

			function fail(error) {
				setState(function (previous) {
					return Object.assign({}, previous, {
						loading: false,
						busy: false,
						error: error && error.message ? error.message : String(error),
					});
				});
			}

			function load() {
				return request(null).then(accept).catch(fail);
			}

			function refresh() {
				if (busyRef.current) return;
				request(null)
					.then(accept)
					.catch(function () {
						/* keep the last accepted snapshot */
					});
			}

			function act(action, payload, notice, exportNote) {
				setState(function (previous) {
					return Object.assign({}, previous, { busy: true, error: "", notice: "" });
				});
				return request(action, payload)
					.then(function (data) {
						setState(function (previous) {
							return {
								loading: false,
								error: "",
								data: data,
								busy: false,
								notice: notice || "",
								exportNote: exportNote || previous.exportNote,
							};
						});
						return data;
					})
					.catch(function (error) {
						setState(function (previous) {
							return Object.assign({}, previous, {
								busy: false,
								error: error && error.message ? error.message : String(error),
							});
						});
						throw error;
					});
			}

			React.useEffect(
				function () {
					load();
					var timer = setInterval(function () {
						if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
						refresh();
					}, 6000);
					return function () {
						clearInterval(timer);
					};
				},
				[],
			);

			var data = current.data;
			if (!data && current.loading) {
				return h(
					"div",
					{ className: "ep-page" },
					h("div", { className: "ep-head" }, h("div", null, h("h2", { className: "ep-title" }, translate("title")), h("p", { className: "ep-sub" }, translate("subtitle")))),
					h("div", { className: "ep-block ep-empty" }, translate("loading")),
				);
			}
			if (!data) {
				return h(
					"div",
					{ className: "ep-page" },
					h("div", { className: "ep-head" }, h("div", null, h("h2", { className: "ep-title" }, translate("title")), h("p", { className: "ep-sub" }, translate("subtitle")))),
					h(
						"div",
						{ className: "ep-block" },
						h("div", { className: "ep-err" }, translate("unavailable")),
						h("p", { className: "ep-hint" }, current.error),
						h("button", { type: "button", className: "ep-btn", onClick: load }, translate("retry")),
					),
				);
			}

			var profiles = Array.isArray(data.profiles) ? data.profiles : [];
			var active = data.active;
			var activeProfile = null;
			for (var i = 0; i < profiles.length; i += 1) {
				if (profiles[i].id === active) {
					activeProfile = profiles[i];
					break;
				}
			}
			var warnings = Array.isArray(data.warnings) ? data.warnings : [];

			return h(
				"div",
				{ className: "ep-page" },
				h(
					"div",
					{ className: "ep-head" },
					h("div", null, h("h2", { className: "ep-title" }, translate("title")), h("p", { className: "ep-sub" }, translate("subtitle"))),
					h(
						"button",
						{
							type: "button",
							className: "ep-btn",
							disabled: current.busy,
							onClick: function () {
								load();
							},
						},
						translate("refresh"),
					),
				),
				current.error ? h("div", { className: "ep-err" }, current.error) : null,
				current.notice ? h("div", { className: "ep-ok" }, current.notice) : null,
				warnings.length
					? h(
							"div",
							{ className: "ep-block" },
							h("div", { className: "ep-block-title" }, translate("warning")),
							warnings.map(function (warning) {
								return h("div", { key: warning, className: "ep-row-hint" }, warning);
							}),
						)
					: null,
				h(CurrentBlock, { data: data, profile: activeProfile }),
				h(
					"section",
					{ className: "ep-block" },
					h("div", { className: "ep-block-title" }, translate("switchTitle")),
					h("p", { className: "ep-hint" }, translate("switchHint")),
					h(
						"div",
						{ className: "ep-grid" },
						profiles.map(function (profile) {
							return h(ProfileCard, {
								key: profile.id,
								profile: profile,
								active: profile.id === active,
								disabled: current.busy,
								onSwitch: function (id) {
									var target = null;
									for (var index = 0; index < profiles.length; index += 1) {
										if (profiles[index].id === id) {
											target = profiles[index];
											break;
										}
									}
									act("switch", { profile: id }, translate("switched") + "：" + (target ? target.name : id)).catch(function () {});
								},
							});
						}),
					),
				),
				h(CreateBlock, {
					data: data,
					busy: current.busy,
					onCreate: function (payload, done) {
						act("create", { profile: payload }, translate("created"))
							.then(function () {
								done("");
							})
							.catch(function (error) {
								var message = error && error.message ? error.message : String(error);
								if (message === "invalid-profile-id") done(translate("invalidId"));
								else if (message === "duplicate-profile-id") done(translate("duplicateId"));
								else done(message);
							});
					},
				}),
				h(SettingsBlock, {
					data: data,
					busy: current.busy,
					exportNote: current.exportNote,
					onSettings: function (patch) {
						act("settings", { settings: patch }, translate("settings")).catch(function () {});
					},
					onExport: function () {
						act("export", {}, "")
							.then(function (result) {
								var info = result && result.export ? result.export : null;
								setState(function (previous) {
									return Object.assign({}, previous, {
										exportNote: info ? translate("exportedCount", { n: info.count }) + " · " + info.dir : translate("exported"),
									});
								});
							})
							.catch(function () {});
					},
				}),
				h(RunsBlock, { runs: data.runs }),
			);
		}

		// ── plugin face ─────────────────────────────────────────────────────
		function apply(ctx) {
			// A plugin reload can race the previous instance's teardown; a duplicate
			// locale namespace must not abort the whole page registration.
			try {
				ctx.locale.register(NS, dictionaries);
			} catch (error) {
				/* already registered by the previous instance */
			}
			try {
				tRef = ctx.locale.bind(NS);
			} catch (error) {
				tRef = function (key) {
					return key;
				};
			}
			var disposeStyles = ensureStyles();
			if (typeof ctx.effect === "function") {
				ctx.effect(function () {
					return disposeStyles;
				});
			}
			ctx.slots.inject("settings.section", function* () {
				yield ctx.slots.register(
					{
						name: "settings.section",
						id: "emotion-profiles",
						order: 65,
						label: function () {
							return tRef("section");
						},
						locale: NS,
					},
					EmotionSettingsPage,
				);
			});
		}

		exports.apply = apply;
		exports.inject = ["slots", "locale"];
		exports.dictionaries = dictionaries;
		// Exposed for the Node render smoke test (test/client-render.mjs); the
		// Host never reads these.
		exports.__components = {
			EmotionSettingsPage: EmotionSettingsPage,
			CurrentBlock: CurrentBlock,
			ProfileCard: ProfileCard,
			CreateBlock: CreateBlock,
			SettingsBlock: SettingsBlock,
			RunsBlock: RunsBlock,
		};
		return module.exports;
	},
});
