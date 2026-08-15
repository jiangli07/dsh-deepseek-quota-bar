// dsh-deepseek-quota — browser half.
//
// A floating card pinned to the bottom-right corner of the dsh web GUI
// (registered into the frame-wide `shell.overlay` slot — additive, above
// every column, click-through until the card opts back into pointer events).
// It polls the host route `/api/deepseek-balance` (see lib/index.js) every
// minute and shows the remaining DeepSeek API balance plus today's
// consumption, with a manual refresh button and explicit error states.
// Styling uses only `--dsw-*` theme tokens that exist in the shipped theme
// build, so it follows light/dark mode.
window.__ModuleLoader__.load({
	id: "dsh-deepseek-quota-bar",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let jsxRuntime = require("react/jsx-runtime");
		const { useState, useEffect, useCallback, useRef } = react;
		const { jsx, jsxs, Fragment } = jsxRuntime;

		// ---- constants -------------------------------------------------
		const POLL_MS = 60 * 1000;
		const BALANCE_PATH = "/api/deepseek-balance";

		// ---- small helpers ---------------------------------------------
		function toFinite(value) {
			if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
			if (typeof value === "string" && value.trim() !== "") {
				const n = Number(value);
				return Number.isFinite(n) ? n : NaN;
			}
			return NaN;
		}

		function currencySymbol(code) {
			switch (code) {
				case "CNY": return "¥";
				case "USD": return "$";
				case "EUR": return "€";
				case "JPY": return "¥";
				case "HKD": return "HK$";
				default: return code ? `${code} ` : "";
			}
		}

		function formatBalance(value, currency) {
			const symbol = currencySymbol(currency);
			return `${symbol}${String(value)}`;
		}

		// 费用展示：按量级选择小数位，避免 ¥0.000000… 长尾（参考 dsh-web-billing）。
		function formatCost(value, currency) {
			const symbol = currencySymbol(currency);
			if (!Number.isFinite(value) || value <= 0) return `${symbol}0`;
			if (value >= 100) return `${symbol}${value.toFixed(0)}`;
			if (value >= 1) return `${symbol}${value.toFixed(2)}`;
			if (value >= 0.01) return `${symbol}${value.toFixed(3)}`;
			return `${symbol}${value.toPrecision(2)}`;
		}

		// 千分位格式化 token 数。
		function formatTokens(value) {
			return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		}

		// 单价展示（¥/M，CNY 计价）。
		function formatRate(rate) {
			const n = rate >= 1 ? rate.toFixed(2) : rate.toFixed(3);
			return `¥${n}/M`;
		}

		function formatTime(date) {
			const hh = String(date.getHours()).padStart(2, "0");
			const mm = String(date.getMinutes()).padStart(2, "0");
			const ss = String(date.getSeconds()).padStart(2, "0");
			return `${hh}:${mm}:${ss}`;
		}

		async function fetchBalance() {
			const res = await fetch(BALANCE_PATH, { cache: "no-store" });
			let body = null;
			try {
				body = await res.json();
			} catch {}
			if (!res.ok) {
				const message =
					body && typeof body.message === "string"
						? body.message
						: `请求失败（HTTP ${res.status}）`;
				const error = new Error(message);
				error.code = body && typeof body.error === "string" ? body.error : `http-${res.status}`;
				throw error;
			}
			// Host shape: { ok, balance, todayConsumed, todayConsumedSource,
			// monthConsumed, monthConsumedSource, monthOpening, ratio }.
			const payload = body && typeof body === "object" && body.balance ? body.balance : body;
			const todayConsumed =
				body && typeof body === "object" && typeof body.todayConsumed === "number"
					? body.todayConsumed
					: null;
			const todayConsumedSource =
				body && typeof body === "object" && typeof body.todayConsumedSource === "string"
					? body.todayConsumedSource
					: "estimate";
			const monthConsumed =
				body && typeof body === "object" && typeof body.monthConsumed === "number"
					? body.monthConsumed
					: null;
			const monthConsumedSource =
				body && typeof body === "object" && typeof body.monthConsumedSource === "string"
					? body.monthConsumedSource
					: "estimate";
			const monthOpening =
				body && typeof body === "object" && typeof body.monthOpening === "number"
					? body.monthOpening
					: null;
			const ratio =
				body && typeof body === "object" && typeof body.ratio === "number"
					? body.ratio
					: null;
			return { payload, todayConsumed, todayConsumedSource, monthConsumed, monthConsumedSource, monthOpening, ratio };
		}

		// ---- inline styles ---------------------------------------------
		const card = {
			position: "absolute",
			right: 16,
			bottom: 16,
			zIndex: 30,
			pointerEvents: "auto",
			boxSizing: "border-box",
			width: 240,
			borderRadius: 12,
			border: 0,
			background: "transparent",
			boxShadow: "none",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 12,
			lineHeight: "18px",
			padding: "8px 10px",
			display: "flex",
			flexDirection: "column",
			gap: 2,
			cursor: "move",
			userSelect: "none",
			touchAction: "none"
		};

		const headerRow = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			height: 20
		};

		const title = {
			flex: 1,
			minWidth: 0,
			display: "flex",
			alignItems: "center",
			gap: 6,
			fontWeight: 600,
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis"
		};

		const refreshButton = {
			flex: "none",
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 20,
			height: 20,
			border: 0,
			borderRadius: 6,
			padding: 0,
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			cursor: "pointer"
		};

		const balanceRow = {
			display: "flex",
			alignItems: "baseline",
			gap: 6
		};

		const balanceValue = {
			fontSize: 20,
			lineHeight: "26px",
			fontWeight: 700,
			fontVariantNumeric: "tabular-nums",
			whiteSpace: "nowrap"
		};

		const statusChip = {
			flex: "none",
			borderRadius: 999,
			padding: "0 6px",
			fontSize: 10,
			lineHeight: "16px"
		};

		// 血条颜色：剩余比例 ≥50% 绿、≥20% 橙、<20% 红。
		function barColor(pct) {
			if (pct >= 50) return "#22c55e";
			if (pct >= 20) return "#f59e0b";
			return "#ef4444";
		}

		const barWrap = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			marginTop: 1
		};

		const barTrack = {
			flex: 1,
			height: 12,
			borderRadius: 999,
			background: "rgba(127, 127, 127, 0.22)",
			border: "1px solid rgba(127, 127, 127, 0.18)",
			overflow: "hidden"
		};

		const barFill = {
			height: "100%",
			borderRadius: 999,
			transition: "width 0.5s ease, background 0.5s ease"
		};

		const barPct = {
			flex: "none",
			minWidth: 34,
			textAlign: "right",
			fontSize: 11,
			lineHeight: "16px",
			fontWeight: 600,
			fontVariantNumeric: "tabular-nums",
			color: "var(--dsw-alias-label-secondary)",
			whiteSpace: "nowrap"
		};

		// 迷你卡（折叠态）：只显示血条 + 百分比 + 展开按钮。
		const miniCard = {
			...card,
			width: 176,
			padding: "6px 8px",
			borderRadius: 10
		};

		const miniBarWrap = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			flex: 1
		};

		const miniPct = {
			...barPct,
			minWidth: 30,
			fontSize: 10
		};

		const miniBtn = {
			flex: "none",
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 18,
			height: 18,
			border: 0,
			borderRadius: 6,
			padding: 0,
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			cursor: "pointer"
		};

		const openingRow = {
			display: "flex",
			alignItems: "center",
			gap: 4,
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 11,
			lineHeight: "16px",
			fontVariantNumeric: "tabular-nums",
			whiteSpace: "nowrap"
		};

		const consumedRow = {
			display: "flex",
			alignItems: "center",
			gap: 4,
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 11,
			lineHeight: "16px",
			fontVariantNumeric: "tabular-nums",
			whiteSpace: "nowrap"
		};

		const convCostRow = {
			display: "flex",
			alignItems: "center",
			gap: 4,
			color: "var(--dsw-alias-label-primary)",
			fontSize: 12,
			lineHeight: "18px",
			fontWeight: 600,
			fontVariantNumeric: "tabular-nums",
			whiteSpace: "nowrap"
		};

		const convCostLabel = {
			color: "var(--dsw-alias-label-secondary)",
			fontWeight: 400
		};

		const infoIcon = {
			flex: "none",
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 14,
			height: 14,
			borderRadius: "50%",
			color: "var(--dsw-alias-label-secondary)",
			cursor: "help",
			verticalAlign: "middle"
		};

		const tipBox = {
			position: "absolute",
			bottom: "calc(100% + 8px)",
			right: 0,
			zIndex: 40,
			boxSizing: "border-box",
			width: 310,
			borderRadius: 10,
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-bg-overlay)",
			boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
			padding: "8px 10px",
			fontSize: 11,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-primary)",
			display: "flex",
			flexDirection: "column",
			gap: 2
		};

		const tipTitle = {
			fontWeight: 600,
			fontSize: 12,
			lineHeight: "18px",
			marginBottom: 2,
			fontVariantNumeric: "tabular-nums"
		};

		const tipRow = {
			display: "flex",
			alignItems: "baseline",
			justifyContent: "space-between",
			gap: 8,
			fontVariantNumeric: "tabular-nums"
		};

		const tipLabel = {
			color: "var(--dsw-alias-label-secondary)",
			flex: "none",
			whiteSpace: "nowrap"
		};

		const tipFormula = {
			color: "var(--dsw-alias-label-primary)",
			textAlign: "right",
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis"
		};

		const tipFooter = {
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 10,
			lineHeight: "16px",
			marginTop: 2,
			borderTop: "1px solid var(--dsw-alias-border-l1)",
			paddingTop: 4,
			fontVariantNumeric: "tabular-nums"
		};

		const metaRow = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 11,
			lineHeight: "16px",
			whiteSpace: "nowrap",
			overflow: "hidden"
		};

		const metaItem = {
			display: "flex",
			alignItems: "center",
			gap: 4,
			fontVariantNumeric: "tabular-nums",
			minWidth: 0,
			overflow: "hidden",
			textOverflow: "ellipsis"
		};

		const updatedRow = {
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 10,
			lineHeight: "14px",
			display: "flex",
			alignItems: "center",
			gap: 4,
			fontVariantNumeric: "tabular-nums"
		};

		const errorText = {
			color: "var(--dsw-alias-state-error-primary)",
			fontSize: 11,
			lineHeight: "16px",
			wordBreak: "break-all"
		};

		const loadingText = {
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 12,
			lineHeight: "18px"
		};

		// ---- the widget -------------------------------------------------
		function DeepSeekQuotaBadge(props) {
			const useSessions = props.useSessions;
			const [data, setData] = useState(null);
			const [phase, setPhase] = useState("loading"); // loading | ready | error
			const [message, setMessage] = useState("");
			const [updatedAt, setUpdatedAt] = useState(null);
			const [spinning, setSpinning] = useState(false);
			const [conversation, setConversation] = useState(null); // 会话费用接口的完整返回（含 breakdown）
			const [tipOpen, setTipOpen] = useState(false);
			const mounted = useRef(true);
			// 卡片位置（可拖动；null = 默认右下角）与折叠状态，均持久化到 localStorage。
			const [pos, setPos] = useState(() => {
				try {
					const p = JSON.parse(localStorage.getItem("dsh-quota-bar-pos"));
					if (p !== null && typeof p === "object" && Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
				} catch {}
				return null;
			});
			const [collapsed, setCollapsed] = useState(() => {
				try { return localStorage.getItem("dsh-quota-bar-collapsed") === "1"; } catch { return false; }
			});
			const dragRef = useRef(null);

			useEffect(() => {
				try {
					if (collapsed) localStorage.setItem("dsh-quota-bar-collapsed", "1");
					else localStorage.removeItem("dsh-quota-bar-collapsed");
				} catch {}
			}, [collapsed]);

			useEffect(() => {
				try {
					if (pos !== null) localStorage.setItem("dsh-quota-bar-pos", JSON.stringify(pos));
				} catch {}
			}, [pos]);

			// 按住卡片（按钮除外）拖动；位移超过 3px 视为拖动，松手后保持新位置。
			const onPointerDown = (e) => {
				if (e.button !== 0) return;
				if (typeof e.target.closest === "function" && e.target.closest("button")) return;
				const rect = e.currentTarget.getBoundingClientRect();
				dragRef.current = {
					startX: e.clientX,
					startY: e.clientY,
					origLeft: pos !== null ? pos.x : rect.left,
					origTop: pos !== null ? pos.y : rect.top,
					moved: false
				};
				try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
			};
			const onPointerMove = (e) => {
				const d = dragRef.current;
				if (d === null) return;
				const dx = e.clientX - d.startX;
				const dy = e.clientY - d.startY;
				if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
				if (d.moved) setPos({ x: d.origLeft + dx, y: d.origTop + dy });
			};
			const onPointerUp = (e) => {
				const d = dragRef.current;
				if (d !== null && d.moved) e.preventDefault();
				dragRef.current = null;
			};
			const onPointerCancel = () => { dragRef.current = null; };

			// 当前会话 id（SessionListState.current，由框架标准属性注入）。
			const currentSessionId = typeof useSessions === "function" ? useSessions((s) => s.current) : void 0;

			// 轮询当前对话费用（宿主按会话日志回放计价，5s 一次，本地路由开销可忽略）。
			useEffect(() => {
				if (currentSessionId === void 0) {
					setConversation(null);
					return;
				}
				let cancelled = false;
				const loadCost = async () => {
					try {
						const res = await fetch(`/api/deepseek-session-cost?sessionId=${encodeURIComponent(currentSessionId)}`, { cache: "no-store" });
						const body = await res.json();
						if (cancelled || body === null || typeof body !== "object" || body.ok !== true) return;
						setConversation(body);
					} catch {}
				};
				loadCost();
				const timer = setInterval(loadCost, 5000);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [currentSessionId]);

			const load = useCallback(async () => {
				setSpinning(true);
				try {
					const result = await fetchBalance();
					if (!mounted.current) return;
					setData(result);
					setPhase("ready");
					setMessage("");
					setUpdatedAt(new Date());
				} catch (error) {
					if (!mounted.current) return;
					setPhase("error");
					setMessage(error instanceof Error ? error.message : String(error));
				} finally {
					if (mounted.current) setSpinning(false);
				}
			}, []);

			useEffect(() => {
				mounted.current = true;
				load();
				const timer = setInterval(load, POLL_MS);
				return () => {
					mounted.current = false;
					clearInterval(timer);
				};
			}, [load]);

			const payload = data ? data.payload : null;
			const balance = payload && Array.isArray(payload.balance_infos) ? payload.balance_infos[0] : null;
			const available = payload ? payload.is_available !== false : null;
			const currency = balance ? balance.currency : "CNY";
			const total = balance ? toFinite(balance.total_balance) : NaN;
			const todayConsumed = data ? data.todayConsumed : null;
			const todayConsumedSource = data ? data.todayConsumedSource : "estimate";
			const monthConsumed = data ? data.monthConsumed : null;
			const monthConsumedSource = data ? data.monthConsumedSource : "estimate";
			const monthOpening = data ? data.monthOpening : null;
			const ratio = data && Number.isFinite(data.ratio) ? data.ratio : (Number.isFinite(total) && monthOpening !== null && monthOpening > 0 ? total / monthOpening : null);
			const pct = ratio !== null ? Math.round(Math.min(1, Math.max(0, ratio)) * 100) : 0;

			const conversationCost = conversation && typeof conversation.cost === "number" ? conversation.cost : null;
			const breakdown = conversation && Array.isArray(conversation.breakdown) ? conversation.breakdown : null;
			const formulaLines = breakdown ? breakdown.filter((b) => b !== null && typeof b === "object" && b.tokens > 0) : [];

			const stateColor =
				phase === "error"
					? "var(--dsw-alias-state-error-primary)"
					: available === false
						? "var(--dsw-alias-state-error-primary)"
						: "var(--dsw-alias-state-success-primary)";

			let chip = null;
			if (phase === "ready") {
				chip = jsx("span", {
					style: {
						...statusChip,
						color: stateColor,
						background: "var(--dsw-alias-interactive-bg-hover)"
					},
					children: available === false ? "不可用" : "可用"
				});
			} else if (phase === "error") {
				chip = jsx("span", {
					style: { ...statusChip, color: stateColor },
					children: "错误"
				});
			}

			const dot = jsx("span", {
				style: {
					flex: "none",
					width: 8,
					height: 8,
					borderRadius: "50%",
					background: phase === "loading" ? "var(--dsw-alias-label-secondary)" : stateColor
				},
				"aria-hidden": true
			});

			const refreshIcon = jsx("svg", {
				width: 13,
				height: 13,
				viewBox: "0 0 16 16",
				fill: "none",
				style: spinning ? { animation: "dsh-quota-spin 0.8s linear infinite" } : void 0,
				children: jsx("path", {
					d: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});

			// 折叠态：迷你血条卡（点击血条区或「+」展开）。
			if (collapsed) {
				return jsx("div", {
					role: "status",
					"aria-live": "polite",
					"data-plugin": "dsh-deepseek-quota-bar",
					title: "DeepSeek 额度（点击展开）",
					style: {
						...miniCard,
						...(pos !== null ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : {})
					},
					onPointerDown,
					onPointerMove,
					onPointerUp,
					onPointerCancel,
					children: jsxs("div", {
						style: miniBarWrap,
						onClick: () => { setCollapsed(false); },
						children: [
							jsx("div", {
								style: { ...barTrack, height: 10, flex: 1 },
								children: jsx("div", {
									style: { ...barFill, width: `${pct}%`, background: barColor(pct) }
								})
							}),
							jsx("span", { style: miniPct, children: `${pct}%` }),
							jsx("button", {
								type: "button",
								style: miniBtn,
								"aria-label": "展开详情",
								title: "展开",
								onClick: (e) => { e.stopPropagation(); setCollapsed(false); },
								children: "+"
							})
						]
					})
				});
			}

			const cardStyle = {
				...card,
				...(pos !== null ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : {})
			};

			return jsx("div", {
				role: "status",
				"aria-live": "polite",
				"data-plugin": "dsh-deepseek-quota-bar",
				title: "DeepSeek API 额度（按住拖动）",
				style: cardStyle,
				onPointerDown,
				onPointerMove,
				onPointerUp,
				onPointerCancel,
				children: jsxs(Fragment, {
					children: [
						jsxs("div", {
							style: headerRow,
							children: [
								dot,
								jsx("span", { style: title, children: "DeepSeek 额度" }),
								jsx("button", {
									type: "button",
									style: refreshButton,
									"aria-label": "折叠为迷你卡片",
									title: "折叠",
									onClick: () => { setCollapsed(true); },
									children: jsx("svg", {
										width: 12,
										height: 12,
										viewBox: "0 0 16 16",
										fill: "none",
										children: jsx("path", {
											d: "M3 8h10",
											stroke: "currentColor",
											strokeWidth: 1.5,
											strokeLinecap: "round"
										})
									})
								}),
								jsx("button", {
									type: "button",
									style: refreshButton,
									"aria-label": "刷新额度",
									title: "刷新",
									disabled: spinning,
									onClick: () => { load(); },
									children: refreshIcon
								})
							]
						}),
						phase === "loading"
							? jsx("div", { style: loadingText, children: "加载中…" })
							: phase === "error"
								? jsx("div", {
									style: errorText,
									title: message,
									children: message
								})
								: jsxs(Fragment, {
									children: [
										jsxs("div", {
											style: balanceRow,
											children: [
												jsx("span", { style: balanceValue, children: balance ? formatBalance(balance.total_balance, currency) : "—" }),
												chip
											]
										}),
										jsxs("div", {
											style: barWrap,
											children: [
												jsx("div", {
													style: barTrack,
													children: jsx("div", {
														style: { ...barFill, width: `${pct}%`, background: barColor(pct) }
													})
												}),
												jsx("span", { style: barPct, children: `${pct}%` })
											]
										}),
										jsxs("div", {
											style: openingRow,
											children: [
												jsx("span", { children: "余额 / 月初" }),
												jsx("span", {
													style: { fontWeight: 600, color: "var(--dsw-alias-label-primary)", fontVariantNumeric: "tabular-nums" },
													children: `${formatCost(total, currency)} / ${monthOpening !== null ? formatCost(monthOpening, currency) : "—"}`
												})
											]
										}),
										currentSessionId !== void 0 && conversationCost !== null
											? jsxs("div", {
												style: convCostRow,
												children: [
													jsx("span", { style: convCostLabel, children: "当前对话费用" }),
													jsx("span", { children: formatCost(conversationCost, currency) }),
													jsx("span", {
														role: "button",
														tabIndex: 0,
														"aria-label": "查看当前对话费用计算公式",
														title: "查看计算公式",
														style: infoIcon,
														onMouseEnter: () => { setTipOpen(true); },
														onMouseLeave: () => { setTipOpen(false); },
														onFocus: () => { setTipOpen(true); },
														onBlur: () => { setTipOpen(false); },
														children: jsx("svg", {
															width: 13,
															height: 13,
															viewBox: "0 0 16 16",
															fill: "none",
															children: jsxs(Fragment, {
																children: [
																	jsx("circle", { cx: 8, cy: 8, r: 6.5, stroke: "currentColor", strokeWidth: 1.3 }),
																	jsx("path", { d: "M8 5v3.6", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
																	jsx("circle", { cx: 8, cy: 11.2, r: 0.9, fill: "currentColor" })
																]
															})
														})
													})
												]
											})
											: null,
										tipOpen && currentSessionId !== void 0 && conversationCost !== null && formulaLines.length > 0
											? jsx("div", {
												role: "tooltip",
												style: tipBox,
												children: jsxs(Fragment, {
													children: [
														jsx("div", { style: tipTitle, children: `当前对话费用 = ${formatCost(conversationCost, currency)}` }),
														...formulaLines.map((b) => jsxs("div", {
															style: tipRow,
															children: [
																jsx("span", { style: tipLabel, children: b.label }),
																jsx("span", {
																	style: tipFormula,
																	children: `${formatTokens(b.tokens)} tok × ${formatRate(b.rate)} = ${formatCost(b.subtotal, currency)}`
																})
															]
														}, b.label)),
														jsx("div", {
															style: tipFooter,
															children: `合计 ${formatCost(conversationCost, currency)} · 按消息时刻官方价格表计价（含峰谷）`
														})
													]
												})
											})
											: null,
										todayConsumed !== null
											? jsx("div", {
												style: consumedRow,
												children: `今日${todayConsumedSource === "official" ? "已消费" : "约消费"} ${formatBalance(todayConsumed, currency)}`
											})
											: null,
										monthConsumed !== null
											? jsx("div", {
												style: consumedRow,
												children: `本月${monthConsumedSource === "official" ? "已消费" : "约消费"} ${formatBalance(monthConsumed, currency)}`
											})
											: null,
										jsxs("div", {
											style: metaRow,
											children: [
												jsx("span", { style: metaItem, children: `赠送 ${balance ? formatBalance(balance.granted_balance, currency) : "—"}` }),
												jsx("span", { children: "·" }),
												jsx("span", { style: metaItem, children: `充值 ${balance ? formatBalance(balance.topped_up_balance, currency) : "—"}` })
											]
										}),
										updatedAt
											? jsx("div", { style: updatedRow, children: `更新于 ${formatTime(updatedAt)}` })
											: null
									]
								})
					]
				})
			});
		}

		// ---- client plugin body -----------------------------------------
		const inject = ["slots"];

		function apply(ctx) {
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "deepseek-quota",
				order: 100,
				label: "DeepSeek 额度"
			}, DeepSeekQuotaBadge));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
