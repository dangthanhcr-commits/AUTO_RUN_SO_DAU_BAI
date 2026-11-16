// ==UserScript==
// @name         Tự động Sổ Ghi Đầu Bài & Lịch Báo Giảng (7.6.3 - rút gọn)
// @namespace    http://tampermonkey.net/
// @version      7.6.3
// @description  Nút Auto thu gọn, kéo thả và nhớ vị trí; hỗ trợ Sổ đầu bài và Lịch báo giảng.
// @author       Võ Hoàng Thiên Ân; hiệu chỉnh theo yêu cầu của Võ Đăng Thành
// @match        *://*.khanhhoa.edu.vn/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

/* eslint-disable */
(function () {
    'use strict';

    if (window.top !== window.self) return;

    const VERSION = '7.6.3';
    const EXPIRATION_DATE = '2027-07-01';
    const ADMIN_PASSWORD = '5/V.C)^ZNnuVc#3#v3d:pI-55m$([+a>k';
    const PANEL_ID = 'sdb-helper-70'; // giữ nguyên ID để phát hiện bản cũ
    const body = () => document.body || document.documentElement;

    let controller = null;
    let statusBox = null;

    function addMenu(label, fn) {
        try {
            if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand(label, fn);
        } catch (e) {
            console.warn('[SDB] Không đăng ký được menu:', e);
        }
    }

    // ==========================================
    // KHỞI ĐỘNG & KÍCH HOẠT
    // ==========================================

    function showStatus(message, canActivate = false) {
        if (!statusBox) {
            statusBox = document.createElement('div');
            statusBox.setAttribute('role', 'status');
        }

        statusBox.style.cssText =
            'position:fixed;right:20px;bottom:20px;z-index:2147483647;width:300px;max-width:85vw;' +
            'box-sizing:border-box;padding:14px;background:#fff;color:#222;border:2px solid #1565c0;' +
            'border-radius:8px;box-shadow:0 4px 18px #0004;font:14px/1.5 Arial,sans-serif;white-space:pre-wrap;';

        statusBox.replaceChildren();

        const title = document.createElement('strong');
        title.textContent = 'Sổ đầu bài / Lịch báo giảng ' + VERSION + '\n';
        const text = document.createElement('div');
        text.textContent = message;
        statusBox.append(title, text);

        if (canActivate) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'Nhập mã kích hoạt';
            btn.style.cssText =
                'display:block;margin-top:10px;padding:8px 12px;background:#1565c0;color:#fff;' +
                'border:0;border-radius:4px;cursor:pointer;font:14px Arial,sans-serif;';
            btn.addEventListener('click', () => start(true));
            statusBox.appendChild(btn);
        }

        body().appendChild(statusBox);
    }

    function start(askForCode = false) {
        try {
            if (controller) return controller.show();

            if (document.getElementById(PANEL_ID)) {
                return showStatus(
                    'Một bản script khác đã tạo bảng điều khiển. Hãy tắt các bản cũ trong Tampermonkey, chỉ giữ bản ' +
                    VERSION + ', rồi tải lại trang.'
                );
            }

            if (Date.now() > new Date(EXPIRATION_DATE).getTime()) {
                return showStatus('Script đã hết thời hạn sử dụng (' + EXPIRATION_DATE + '). Hãy liên hệ người cấp mã.');
            }

            if (typeof GM_getValue !== 'function' || typeof GM_setValue !== 'function') {
                return showStatus(
                    'Thiếu API lưu cấu hình của Tampermonkey. Hãy dán toàn bộ mã, gồm phần // ==UserScript== và các dòng @grant, rồi lưu và tải lại.'
                );
            }

            if (!GM_getValue('SDB_IS_ACTIVATED', false)) {
                if (!askForCode) {
                    return showStatus('Script đã chạy. Cần kích hoạt trước khi sử dụng các nút xử lý.', true);
                }

                const code = prompt('Nhập Mã Kích Hoạt để mở bảng điều khiển:');

                if (code !== ADMIN_PASSWORD) {
                    return showStatus(
                        code === null
                            ? 'Bạn đã hủy nhập mã, hoặc trình duyệt chưa cho hiện hộp nhập. Bấm nút bên dưới để thử lại.'
                            : 'Mã kích hoạt chưa đúng. Bạn có thể nhập lại.',
                        true
                    );
                }

                GM_setValue('SDB_IS_ACTIVATED', true);
            }

            controller = startMain();
            statusBox?.remove();
            controller.show();
        } catch (error) {
            console.error('[SDB ' + VERSION + '] Khởi tạo thất bại:', error);
            showStatus('Lỗi khởi động: ' + (error?.message || String(error)) + '\nHãy gửi nguyên văn thông báo này để kiểm tra.');
        }
    }

    addMenu('Hiện bảng điều khiển SDB / LBG ' + VERSION, () => start());

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', () => start(), { once: true });

    // ==========================================
    // LOGIC CHÍNH
    // ==========================================

    function startMain() {
        const FIELD_CONFIRM = 'IS_GV_XAC_NHAN';
        const DONE = 'hoàn thành';

        const norm = v => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi');
        const blank = v => v == null || String(v).trim() === '';
        const read = (item, field) => !field ? undefined : typeof item?.get === 'function' ? item.get(field) : item?.[field];
        const delay = ms => new Promise(r => setTimeout(r, ms));
        const visible = el => !!el && el.getClientRects().length > 0;
        const same = (a, b) => String(a) === String(b);

        async function until(probe, message, timeout = 3000) {
            const end = Date.now() + timeout;
            do {
                const result = probe();
                if (result) return result;
                await delay(50);
            } while (Date.now() < end);
            throw new Error(message);
        }

        let busy = false;

        function getContext() {
            const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const frame = pageWindow.document.getElementById('iframesite');

            try {
                const win = frame ? frame.contentWindow : pageWindow;
                const doc = win.document;
                if (!doc?.body) throw new Error('Trang đang tải. Vui lòng chờ.');
                return { win, doc, $: win.jQuery || win.$ };
            } catch (e) {
                throw new Error('Chưa truy cập được nội dung: ' + e.message);
            }
        }

        // ---------- Kendo Grid (Sổ đầu bài) ----------

        const leafColumns = cols =>
            (cols || []).flatMap(c => c.columns?.length ? leafColumns(c.columns) : [c]);

        function findGrid(ctx) {
            if (typeof ctx.$ !== 'function') return null;

            const matches = [];

            for (const el of ctx.doc.querySelectorAll('.k-grid')) {
                const grid = ctx.$(el).data('kendoGrid');
                if (!grid || !visible(el)) continue;

                const cols = leafColumns(grid.columns);
                if (cols.some(c => c.field === FIELD_CONFIRM || c.field === 'NHAN_XET_GIAO_VIEN')) {
                    matches.push(grid);
                }
            }

            if (matches.length > 1) throw new Error('Có nhiều bảng đang mở. Hãy chỉ mở bảng cần xử lý.');
            return matches[0] || null;
        }

        const rootOf = grid => grid.wrapper?.[0] || grid.element[0];

        const rowsOf = grid =>
            Array.from(rootOf(grid).querySelectorAll('tbody tr[data-uid]'))
                .filter(row => visible(row) && grid.dataItem(row));

        const rowByUid = (grid, uid) => rowsOf(grid).filter(r => r.getAttribute('data-uid') === uid);

        function cellForField(grid, uid, field) {
            const headerIds = new Set(
                Array.from(rootOf(grid).querySelectorAll('th[data-field]'))
                    .filter(th => th.getAttribute('data-field') === field)
                    .map(th => th.id)
                    .filter(Boolean)
            );

            for (const row of rowByUid(grid, uid)) {
                for (const cell of Array.from(row.cells)) {
                    const ids = (cell.getAttribute('aria-describedby') || '').split(/\s+/);
                    if (ids.some(id => headerIds.has(id)) || cell.getAttribute('data-field') === field) {
                        return cell;
                    }
                }
            }
            return null;
        }

        function itemByUid(grid, uid) {
            const row = rowByUid(grid, uid)[0];
            return row ? grid.dataItem(row) : null;
        }

        const hasLesson = item =>
            !blank(read(item, 'ID_TKB_MON_HOC')) || !blank(read(item, 'TEN_BAI_DAY'));

        function parseDay(value) {
            const text = String(value ?? '');
            const vn = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
            const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})(?=T|\b)/);
            if (!vn && !iso) return null;

            const [year, month, day] = vn ? [+vn[3], +vn[2], +vn[1]] : [+iso[1], +iso[2], +iso[3]];
            const date = new Date(Date.UTC(year, month - 1, day));

            if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
                return null;
            }

            const dd = String(day).padStart(2, '0');
            const mm = String(month).padStart(2, '0');
            const wd = date.getUTCDay() === 0 ? 'Chủ nhật' : `Thứ ${date.getUTCDay() + 1}`;

            return { key: `${year}-${mm}-${dd}`, label: `${wd} — ${dd}/${mm}/${year}` };
        }

        function datedRows(grid) {
            const entries = new Map();

            for (const row of rowsOf(grid)) {
                const uid = row.getAttribute('data-uid');
                if (entries.has(uid)) continue;

                const item = grid.dataItem(row);
                const day =
                    parseDay(read(item, 'THU_NGAY')) ||
                    parseDay(cellForField(grid, uid, 'THU_NGAY')?.textContent) ||
                    parseDay(read(item, 'NGAY'));

                entries.set(uid, { uid, day, hasLesson: hasLesson(item) });
            }

            return [...entries.values()];
        }

        const dayOptions = entries =>
            [...new Map(entries.filter(e => e.day).map(e => [e.day.key, e.day])).values()]
                .sort((a, b) => a.key.localeCompare(b.key));

        function chooseRows(entries, scope, total = entries.length) {
            if (!entries.length) throw new Error('Bảng chưa có dữ liệu. Hãy chờ tải đầy đủ.');
            if (total > entries.length) {
                throw new Error('Bảng đang chia nhiều trang. Hãy tăng Số bản ghi/trang rồi chạy lại.');
            }

            if (scope === 'week') return entries.map(e => e.uid);
            if (!scope) throw new Error('Hãy chọn Phạm vi.');
            if (entries.some(e => e.hasLesson && !e.day)) throw new Error('Có tiết chưa đọc được ngày.');

            const selected = entries.filter(e => e.day?.key === scope);
            if (!selected.length) throw new Error('Ngày đã chọn không còn trong bảng.');
            return selected.map(e => e.uid);
        }

        function canEdit(grid, item, field) {
            const col = leafColumns(grid.columns).find(c => c.field === field);

            if (!col || col.hidden || col.editable === false) return false;
            if (typeof col.editable === 'function' && col.editable(item) === false) return false;
            return typeof item.editable !== 'function' || item.editable(field) !== false;
        }

        function completionChoice(widget) {
            const textField = widget.options.dataTextField;
            const valueField = widget.options.dataValueField;

            if (!textField || !valueField) throw new Error('Dropdown thiếu cấu hình trường nhãn/giá trị.');

            const choices = Array.from(widget.dataSource.data())
                .filter(item => norm(read(item, textField)) === DONE);

            if (choices.length > 1) throw new Error('Nhiều lựa chọn Hoàn thành.');
            if (!choices.length) return null;

            const value = read(choices[0], valueField);
            if (blank(value)) throw new Error('Lựa chọn Hoàn thành không hợp lệ.');
            return { value };
        }

        async function confirmRow(ctx, grid, uid) {
            let item = itemByUid(grid, uid);
            if (!item) throw new Error('Dòng đã thay đổi. Hãy chạy lại.');
            if (!hasLesson(item)) return 'empty';

            let cell = cellForField(grid, uid, FIELD_CONFIRM);
            if (!cell) throw new Error('Không ánh xạ được ô Xác nhận.');
            if (norm(cell.textContent) === DONE) return 'done';
            if (!canEdit(grid, item, FIELD_CONFIRM) || !visible(cell)) return 'locked';

            try {
                grid.editCell(ctx.$(cell));

                const editor = await until(() => {
                    cell = cellForField(grid, uid, FIELD_CONFIRM);
                    if (!cell) return null;

                    const input = Array.from(cell.querySelectorAll('input,select'))
                        .find(el => el.name === FIELD_CONFIRM);
                    if (!input) return null;

                    const widget = ctx.$(input).data('kendoDropDownList');
                    if (widget) return { widget };
                    if (input.tagName === 'SELECT' && !input.getAttribute('data-role')) return { select: input };
                    return null;
                }, 'Không mở được dropdown Xác nhận.');

                let expected;

                if (editor.widget) {
                    const w = editor.widget;

                    if (w.wrapper?.attr('aria-disabled') === 'true' || w.wrapper?.attr('aria-readonly') === 'true') {
                        return 'locked';
                    }

                    expected = (await until(() => completionChoice(w), 'Chưa tải dữ liệu Dropdown.')).value;
                    w.value(expected);
                    await until(() => same(w.value(), expected), 'Không nhận giá trị.');
                    w.trigger('change');
                } else {
                    const select = editor.select;
                    if (select.disabled) return 'locked';

                    const option = Array.from(select.options).find(o => norm(o.text) === DONE);
                    if (!option || blank(option.value)) throw new Error('Select không có giá trị.');

                    expected = option.value;
                    select.value = expected;
                    select.dispatchEvent(new ctx.win.Event('change', { bubbles: true }));
                }

                await until(() => {
                    item = itemByUid(grid, uid);
                    return item && same(read(item, FIELD_CONFIRM), expected);
                }, 'Dữ liệu dòng chưa cập nhật.');

                grid.closeCell();

                await until(() => {
                    const current = cellForField(grid, uid, FIELD_CONFIRM);
                    const model = itemByUid(grid, uid);
                    return model && current && norm(current.textContent) === DONE &&
                        same(read(model, FIELD_CONFIRM), expected);
                }, 'Chưa xác minh được trạng thái.');

                return 'changed';
            } finally {
                grid.closeCell();
            }
        }

        // ---------- Lịch báo giảng (Telerik / select cũ) ----------

        const legacyKey = v =>
            norm(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '');

        const keyOf = el => legacyKey([el.id, el.getAttribute('name'), el.getAttribute('data-field')].join(' '));
        const teacherConfirmId = v => /trangthaigv|xacnhangv|gvxacnhan|giaovienxacnhan|xacnhangiaovien/.test(legacyKey(v));
        const legacyCell = el => el.closest('td,th');

        function legacyHeader(cell) {
            if (!cell) return '';

            const explicit = (cell.getAttribute('headers') || cell.getAttribute('aria-describedby') || '')
                .split(/\s+/)
                .map(id => cell.ownerDocument.getElementById(id)?.textContent || '')
                .join(' ');
            if (explicit.trim()) return explicit;

            // Không đoán vị trí cột trong bảng có ô gộp.
            const table = cell.closest('table');
            if (!table || Array.from(cell.parentElement.cells).some(c => c.colSpan !== 1)) return '';

            for (const row of Array.from(table.rows)) {
                const cells = Array.from(row.cells);
                if (row.closest('table') !== table || !cells.some(c => c.tagName === 'TH')) continue;
                if (cells.some(c => c.colSpan !== 1 || c.rowSpan !== 1)) continue;

                const header = row.cells[cell.cellIndex];
                if (header) return header.textContent || '';
            }
            return '';
        }

        const teacherConfirmControl = el =>
            teacherConfirmId(el.id + ' ' + (el.getAttribute('name') || '') + ' ' + (el.getAttribute('data-field') || '')) ||
            teacherConfirmId(legacyHeader(legacyCell(el)));

        function legacyComponent(ctx, id) {
            const c = id && typeof ctx.win.$find === 'function' ? ctx.win.$find(id) : null;
            return c && typeof c.get_items === 'function' && typeof c.get_selectedItem === 'function' ? c : null;
        }

        function legacyControls(ctx) {
            const roots = new Set(ctx.doc.querySelectorAll('.RadComboBox, .RadDropDownList, select'));

            // Chuẩn hóa ID con về control cha, tránh đếm trùng.
            for (const el of ctx.doc.querySelectorAll('[id]')) {
                if (!teacherConfirmId(el.id)) continue;

                const rootId = el.id.replace(/_(Input|ClientState|Arrow|DropDown|Text)$/i, '');
                const root = el.closest('.RadComboBox, .RadDropDownList, select') || ctx.doc.getElementById(rootId);

                if (root && (root.tagName === 'SELECT' || legacyComponent(ctx, root.id) || root.querySelector('input.rcbInput'))) {
                    roots.add(root);
                }
            }

            return Array.from(roots).filter(el =>
                teacherConfirmControl(el) && !el.closest('#' + PANEL_ID) && visible(el) && legacyCell(el)
            );
        }

        function lessonValue(el) {
            if (el.matches('input[type="hidden"]')) return '';
            if (el.tagName === 'SELECT') {
                if (blank(el.value) || /^(0|-1)$/.test(el.value)) return '';
                return el.options[el.selectedIndex]?.text || '';
            }
            return 'value' in el ? el.value : el.textContent;
        }

        function meaningfulLesson(value) {
            const t = norm(value);
            return !!t && !/^(?:[-–—\s]+|0|-1)$/.test(t) && !/^[-–—\s]*(?:chọn|lựa chọn|select)(?:\s|$)/.test(t);
        }

        // true / false / null (không nhận diện được)
        function hasLessonLegacy(element) {
            const cell = legacyCell(element);
            const row = cell?.parentElement;
            if (!row || row.tagName !== 'TR') return null;

            const named = Array.from(row.querySelectorAll('input,textarea,select,span[id],[data-field]'))
                .filter(el =>
                    !cell.contains(el) &&
                    !el.matches('input[type="hidden"]') &&
                    !/_ClientState$/i.test(el.id || '') &&
                    /tenbaiday|tenbai|noidungbaiday|noidungday|baihoc|monhoc/.test(keyOf(el))
                );

            if (named.length) return named.some(el => meaningfulLesson(lessonValue(el)));

            const lessonCells = Array.from(row.cells).filter(c =>
                /tenbaiday|baiday|noidungbaiday|noidungday|baihoc|monhoc/.test(legacyKey(legacyHeader(c)))
            );
            if (!lessonCells.length) return null;

            return lessonCells.some(c => {
                const inputs = Array.from(c.querySelectorAll('input:not([type="hidden"]),textarea,select'));
                return inputs.length ? inputs.some(el => meaningfulLesson(lessonValue(el))) : meaningfulLesson(c.textContent);
            });
        }

        function legacyChoice(component) {
            const items = component.get_items();
            const choices = [];

            for (let i = 0; i < items.get_count(); i++) {
                const item = items.getItem(i);
                if (norm(item.get_text()) === DONE) choices.push(item);
            }

            if (choices.length > 1) throw new Error('Dropdown có nhiều mục Hoàn thành; cần kiểm tra thủ công.');
            return choices[0] || null;
        }

        const legacyIsDone = c => {
            const s = c.get_selectedItem();
            return !!s && norm(s.get_text()) === DONE && same(c.get_value(), s.get_value());
        };

        async function waitLegacyAjax(ctx) {
            const check = () => {
                if (getContext().doc !== ctx.doc) {
                    throw new Error('Trang hoặc iframe đã đổi. Hãy mở lại tuần cần xử lý.');
                }
            };

            check();

            const manager = ctx.win.Sys?.WebForms?.PageRequestManager?.getInstance?.();
            if (manager?.get_isInAsyncPostBack) {
                await until(() => !manager.get_isInAsyncPostBack(), 'Trang vẫn đang tải AJAX. Hãy chờ rồi chạy lại.', 10000);
            }

            check();
        }

        function resolveLegacy(ctx, el) {
            const current = el.id ? ctx.doc.getElementById(el.id) : el;
            if (!current?.isConnected || !teacherConfirmControl(current)) {
                throw new Error('Dropdown đã bị thay thế hoặc không còn đúng cột xác nhận.');
            }
            return current;
        }

        async function confirmLegacyControl(ctx, original) {
            await waitLegacyAjax(ctx);

            let el = resolveLegacy(ctx, original);

            if (
                !visible(el) ||
                el.matches(':disabled,[aria-disabled="true"],[aria-readonly="true"]') ||
                el.closest('[aria-disabled="true"]')
            ) {
                return 'locked';
            }

            const lesson = hasLessonLegacy(el);
            if (lesson === false) return 'empty';
            if (lesson === null) return 'unknown';

            const component = legacyComponent(ctx, el.id);

            if (component) {
                if (component.get_enabled?.() === false) return 'locked';
                if (legacyIsDone(component)) return 'done';

                let choice = legacyChoice(component);

                if (!choice && component.get_enableLoadOnDemand?.() && component.showDropDown) {
                    component.showDropDown();
                    try {
                        choice = await until(() => legacyChoice(component), 'Chưa tải được mục Hoàn thành.', 5000);
                    } finally {
                        component.hideDropDown?.();
                    }
                }

                if (!choice) throw new Error('Dropdown không có mục Hoàn thành.');
                if (choice.get_enabled?.() === false) return 'locked';

                const expected = choice.get_value();
                if (blank(expected)) throw new Error('Mục Hoàn thành thiếu giá trị.');

                choice.select(); // API Telerik: cập nhật selection/client state và phát sự kiện chọn.

                await delay(150);
                await waitLegacyAjax(ctx);

                await until(() => {
                    el = resolveLegacy(ctx, original);
                    const cur = legacyComponent(ctx, el.id);
                    return cur && legacyIsDone(cur) && same(cur.get_value(), expected);
                }, 'Trang chưa nhận lựa chọn Hoàn thành (có thể đã hủy thay đổi).');

                return 'changed';
            }

            if (el.tagName !== 'SELECT') {
                throw new Error('Không lấy được control Telerik qua $find. Kiểm tra @grant unsafeWindow và tải lại trang.');
            }

            const choices = Array.from(el.options).filter(o => norm(o.text) === DONE);
            if (choices.length !== 1 || blank(choices[0].value)) {
                throw new Error('Không xác định được duy nhất giá trị Hoàn thành.');
            }

            const choice = choices[0];
            if (choice.disabled || choice.parentElement?.disabled) return 'locked';
            if (el.selectedIndex === choice.index) return 'done';

            const expected = choice.value;
            el.value = expected;
            for (const type of ['input', 'change']) el.dispatchEvent(new ctx.win.Event(type, { bubbles: true }));

            await delay(150);
            await waitLegacyAjax(ctx);

            el = resolveLegacy(ctx, original);
            if (el.value !== expected || norm(el.options[el.selectedIndex]?.text) !== DONE) {
                throw new Error('Trang chưa nhận lựa chọn Hoàn thành.');
            }

            return 'changed';
        }

        // ---------- Chạy hàng loạt & báo cáo (dùng chung) ----------

        async function runBatch(items, label, handler) {
            const r = { changed: 0, done: 0, empty: 0, locked: 0, unknown: 0, errors: [] };

            for (let i = 0; i < items.length; i++) {
                btnConfirm.textContent = `⏳ ${label} ${i + 1}/${items.length}...`;

                try {
                    r[await handler(items[i])]++;
                } catch (e) {
                    r.errors.push(`Dòng ${i + 1}: ${e.message}`);
                    break;
                }
            }

            const skipped = `Bỏ qua: ${r.empty} trống, ${r.locked} khóa` +
                (r.unknown ? `, ${r.unknown} chưa nhận diện được bài dạy.` : '.');

            const lines = [
                `Đã xác nhận: ${r.changed} tiết.`,
                `Đã xong từ trước: ${r.done}.`,
                skipped
            ];

            if (r.unknown) lines.push('Các dòng chưa nhận diện cần kiểm tra thủ công; tool chưa thay đổi những dòng này.');

            if (r.errors.length) {
                const processed = r.changed + r.done + r.empty + r.locked + r.unknown + r.errors.length;
                lines.push('⚠️ ' + r.errors[0], `Đã dừng; còn ${items.length - processed} dòng chưa xử lý.`);
            }

            if (r.changed) lines.push('Đây là kết quả trên giao diện. Hãy kiểm tra và bấm Ghi để lưu.');

            alert(lines.join('\n'));
        }

        async function confirmLegacy(ctx) {
            if (scopeSelect.value !== 'week') {
                throw new Error('Lịch báo giảng chỉ hỗ trợ "Cả tuần đang mở".');
            }

            await waitLegacyAjax(ctx);

            const elements = await until(() => {
                const found = legacyControls(ctx);
                return found.length ? found : null;
            }, 'Không tìm thấy dropdown Xác nhận của giáo viên. Hãy mở Lịch báo giảng, chờ tải xong; nếu vẫn lỗi, gửi ảnh cột Xác nhận và HTML của dropdown.');

            if (new Set(elements.map(el => legacyCell(el)?.closest('table'))).size > 1) {
                throw new Error('Có nhiều bảng xác nhận đang mở. Hãy chỉ mở bảng cần xử lý.');
            }

            await runBatch(elements, 'Lịch báo giảng', el => confirmLegacyControl(ctx, el));
        }

        // ==========================================
        // GIAO DIỆN AUTO
        // ==========================================

        const AUTO_UI = {
            width: 52,
            height: 34,
            panelWidth: 280,
            background: '#7D2147',
            border: '#D69AB4',
            color: '#FFFFFF',
            defaultXRatio: 0.48,
            defaultTop: 8,
            anchorGap: 70
        };

        const POSITION_KEY = 'SDB_AUTO_POSITION_V76';
        const MARGIN = 8;

        let savedPosition = null;

        try {
            const v = GM_getValue(POSITION_KEY, null);
            if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) savedPosition = { x: v.x, y: v.y };
        } catch (e) {
            console.warn('[SDB] Không đọc được vị trí đã lưu:', e);
        }

        const wrapper = document.createElement('div');
        wrapper.id = PANEL_ID;
        wrapper.style.cssText =
            `position:fixed;left:0;top:0;z-index:2147483647;display:block;width:${AUTO_UI.width}px;` +
            `height:${AUTO_UI.height}px;margin:0;padding:0;overflow:visible;background:transparent!important;` +
            'border:0!important;box-shadow:none!important;box-sizing:border-box;';

        const header = document.createElement('button');
        header.type = 'button';
        header.textContent = 'Auto';
        header.title = 'Bấm để mở/thu gọn. Giữ và kéo để di chuyển.';
        header.style.cssText =
            `display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:${AUTO_UI.width}px;` +
            `height:${AUTO_UI.height}px;padding:0;margin:0;background:${AUTO_UI.background};color:${AUTO_UI.color};` +
            `border:1px solid ${AUTO_UI.border};border-radius:7px;cursor:grab;font:700 13px/1 Arial,sans-serif;` +
            'letter-spacing:.2px;box-shadow:0 2px 5px #46102726;user-select:none;touch-action:none;';

        const contentBox = document.createElement('div');
        contentBox.style.cssText =
            'display:none;position:fixed;box-sizing:border-box;overflow-y:auto;flex-direction:column;gap:9px;' +
            'padding:14px;background:#fff;color:#263238;border:1px solid #E1C6D2;border-radius:10px;' +
            'font:13px/1.4 Arial,sans-serif;box-shadow:0 8px 24px #46102726;text-align:left;';

        const scopeSelect = document.createElement('select');
        scopeSelect.setAttribute('aria-label', 'Phạm vi xử lý');
        scopeSelect.style.cssText =
            'width:100%;padding:7px;border:1px solid #CCD4D8;border-radius:5px;background:#fff;' +
            'color:#263238;box-sizing:border-box;font:13px Arial,sans-serif;';
        contentBox.appendChild(scopeSelect);

        function makeButton(text, bg) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = text;
            btn.style.cssText =
                `padding:10px;background:${bg};color:#fff;border:0;margin:0;border-radius:6px;cursor:pointer;` +
                'width:100%;box-sizing:border-box;font:600 13px/1.4 Arial,sans-serif;';
            contentBox.appendChild(btn);
            return btn;
        }

        const btnFill = makeButton('✍️ 1. Điền Nhận xét & Xếp loại', '#007CA3');
        const btnConfirm = makeButton('✅ 2. Xác nhận Hoàn thành', '#8F2852');
        const buttons = [btnFill, btnConfirm];

        wrapper.append(header, contentBox);
        document.body.appendChild(wrapper);

        let isOpen = false;
        let drag = null;
        let ignoreClickUntil = 0;

        const clamp = (v, min, max) => Math.max(min, Math.min(v, Math.max(min, max)));

        function defaultPosition() {
            // Neo cạnh ô chọn phân hệ trên thanh đầu trang.
            for (const el of document.querySelectorAll('select,input,span,a,button')) {
                if (wrapper.contains(el) || !visible(el)) continue;

                const label = el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text
                    : el.tagName === 'INPUT' ? el.value : el.textContent;

                if (!/^quản lý giáo dục (thcs|thpt|tiểu học)$/i.test(norm(label))) continue;

                const anchor = el.closest('.RadComboBox,.k-dropdown,.k-dropdownlist,.input-group,.btn-group') || el;
                let rect = anchor.getBoundingClientRect();
                if (rect.width > window.innerWidth * 0.65) rect = el.getBoundingClientRect();
                if (rect.width < 1 || rect.top < 0 || rect.top > 120) continue;

                return { x: rect.right + AUTO_UI.anchorGap, y: rect.top + (rect.height - AUTO_UI.height) / 2 };
            }

            return { x: Math.round(window.innerWidth * AUTO_UI.defaultXRatio), y: AUTO_UI.defaultTop };
        }

        function placePanel() {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const pos = savedPosition || defaultPosition();

            const x = clamp(pos.x, MARGIN, vw - AUTO_UI.width - MARGIN);
            const y = clamp(pos.y, MARGIN, vh - AUTO_UI.height - MARGIN);

            wrapper.style.left = x + 'px';
            wrapper.style.top = y + 'px';

            const panelWidth = Math.min(AUTO_UI.panelWidth, Math.max(1, vw - 2 * MARGIN));
            contentBox.style.width = panelWidth + 'px';
            contentBox.style.maxHeight = Math.max(1, vh - 2 * MARGIN) + 'px';
            contentBox.style.left = clamp(x, MARGIN, vw - panelWidth - MARGIN) + 'px';

            const panelHeight = isOpen ? contentBox.offsetHeight : 0;
            let top = y + AUTO_UI.height + MARGIN;
            if (isOpen && top + panelHeight > vh - MARGIN) top = y - panelHeight - MARGIN;

            contentBox.style.top = clamp(top, MARGIN, vh - panelHeight - MARGIN) + 'px';
        }

        function setPanelOpen(open) {
            isOpen = Boolean(open);
            contentBox.style.display = isOpen ? 'flex' : 'none';
            header.setAttribute('aria-expanded', String(isOpen));
            placePanel();
        }

        function savePosition() {
            try {
                GM_setValue(POSITION_KEY, savedPosition);
            } catch (e) {
                console.warn('[SDB] Không lưu được vị trí:', e);
            }
        }

        header.addEventListener('pointerdown', e => {
            if (e.button !== 0 || e.isPrimary === false) return;

            const rect = wrapper.getBoundingClientRect();
            drag = {
                id: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                x: rect.left,
                y: rect.top,
                previous: savedPosition,
                moved: false
            };

            try { header.setPointerCapture(e.pointerId); } catch (_) {}
        });

        header.addEventListener('pointermove', e => {
            if (!drag || drag.id !== e.pointerId) return;

            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;
            if (!drag.moved && Math.hypot(dx, dy) < 5) return;

            drag.moved = true;
            e.preventDefault();
            header.style.cursor = 'grabbing';

            savedPosition = {
                x: clamp(drag.x + dx, MARGIN, window.innerWidth - AUTO_UI.width - MARGIN),
                y: clamp(drag.y + dy, MARGIN, window.innerHeight - AUTO_UI.height - MARGIN)
            };
            placePanel();
        });

        function endDrag(e, cancelled = false) {
            if (!drag || drag.id !== e.pointerId) return;

            const finished = drag;
            drag = null;
            header.style.cursor = 'grab';

            if (finished.moved) {
                ignoreClickUntil = Date.now() + 350;
                if (cancelled) {
                    savedPosition = finished.previous;
                    placePanel();
                } else {
                    savePosition();
                }
            }

            try {
                if (header.hasPointerCapture(e.pointerId)) header.releasePointerCapture(e.pointerId);
            } catch (_) {}
        }

        header.addEventListener('pointerup', e => endDrag(e));
        header.addEventListener('pointercancel', e => endDrag(e, true));
        header.addEventListener('lostpointercapture', e => endDrag(e, true));

        header.addEventListener('click', e => {
            if (e.detail !== 0 && Date.now() < ignoreClickUntil) return e.preventDefault();
            setPanelOpen(!isOpen);
        });

        addMenu('Đặt lại vị trí nút Auto', () => {
            savedPosition = null;
            savePosition();
            placePanel();
        });

        window.addEventListener('resize', placePanel);
        const layoutTimer = setTimeout(placePanel, 600);
        setPanelOpen(false);

        // ---------- Phạm vi (ngày / cả tuần) ----------

        let scopeSignature = null;

        function renderScope(entries) {
            const days = dayOptions(entries);
            const signature = days.map(d => d.key).join('|');
            if (signature === scopeSignature) return;

            const previous = scopeSignature === null ? 'week' : scopeSelect.value;

            scopeSelect.replaceChildren();

            for (const item of [
                { key: '', label: '— Chọn phạm vi —' },
                { key: 'week', label: 'Cả tuần đang mở' },
                ...days
            ]) {
                const opt = document.createElement('option');
                opt.value = item.key;
                opt.textContent = item.label;
                scopeSelect.appendChild(opt);
            }

            scopeSelect.value = previous === 'week' || days.some(d => d.key === previous) ? previous : '';
            scopeSignature = signature;
        }

        function syncScope() {
            if (busy || !wrapper.isConnected) return;

            try {
                const grid = findGrid(getContext());
                renderScope(grid ? datedRows(grid) : []);
            } catch (_) {
                renderScope([]);
            }
        }

        function selectedScope(grid) {
            const entries = datedRows(grid);
            const requested = scopeSelect.value;

            renderScope(entries);
            if (scopeSelect.value !== requested) throw new Error('Bảng đã đổi tuần. Hãy chọn lại.');

            const total = typeof grid.dataSource.total === 'function' ? grid.dataSource.total() : entries.length;
            return chooseRows(entries, requested, total);
        }

        renderScope([]);
        syncScope();
        scopeSelect.addEventListener('pointerdown', syncScope);
        scopeSelect.addEventListener('focus', syncScope);

        const scopeTimer = setInterval(syncScope, 1200);

        window.addEventListener('pagehide', () => {
            window.removeEventListener('resize', placePanel);
            clearTimeout(layoutTimer);
            clearInterval(scopeTimer);
        }, { once: true });

        async function run(btn, action) {
            if (busy) return;

            busy = true;
            scopeSelect.disabled = true;
            const label = btn.textContent;

            buttons.forEach(b => { b.disabled = true; b.style.opacity = '0.65'; });
            btn.textContent = '⏳ Đang xử lý...';

            try {
                await action();
            } catch (e) {
                alert('⚠️ ' + e.message);
            } finally {
                busy = false;
                scopeSelect.disabled = false;
                btn.textContent = label;
                buttons.forEach(b => { b.disabled = false; b.style.opacity = '1'; });
            }
        }

        // ==========================================
        // 1. ĐIỀN NHẬN XÉT VÀ ĐIỂM
        // ==========================================

        const PRAISES = ['Học tốt', 'Tích cực', 'Sôi nổi', 'Nghiêm túc', 'Tương tác tốt'];
        const SCORES = [
            ['XEP_LOAI_HOC_TAP', 4],
            ['XEP_LOAI_KY_LUAT', 3],
            ['XEP_LOAI_VE_SINH', 2],
            ['XEP_LOAI_CHUYEN_CAN', 1]
        ];
        // Khớp theo từ nguyên vẹn để "th" không dính vào các từ như "thứ", "thế"...
        const EXAM_RE = /kiểm tra|thực hành|(?:^|\s)(?:kt|th)(?:\s|$)/;

        // Nhập qua ô để web tự tính Tổng/Xếp loại; lỗi thì ghi thẳng vào model.
        async function setScore(ctx, grid, item, uid, field, value) {
            const cell = cellForField(grid, uid, field);
            if (!cell || !visible(cell)) return item.set(field, value);

            try {
                grid.editCell(ctx.$(cell));
                await delay(20);

                const input = cell.querySelector('input');

                if (input) {
                    const widget = ctx.$(input).data('kendoNumericTextBox');

                    if (widget) {
                        widget.value(value);
                        widget.trigger('change');
                    } else {
                        input.value = value;
                        for (const type of ['input', 'change']) {
                            input.dispatchEvent(new ctx.win.Event(type, { bubbles: true }));
                        }
                    }
                }

                grid.trigger('save', { model: item, values: { [field]: value } });
                grid.closeCell();
                await delay(15);
            } catch (e) {
                grid.closeCell();
                item.set(field, value);
            }
        }

        btnFill.addEventListener('click', () => run(btnFill, async () => {
            const ctx = getContext();
            const grid = findGrid(ctx);

            if (!grid) throw new Error('Chưa tìm thấy bảng.');
            if (grid.dataSource.options?.autoSync) throw new Error('Bảng đang tự lưu.');

            grid.closeCell();

            const uids = selectedScope(grid);
            let count = 0;

            for (let i = 0; i < uids.length; i++) {
                const uid = uids[i];
                btnFill.textContent = `⏳ Đang nhập liệu ${i + 1}/${uids.length}...`;

                const item = itemByUid(grid, uid);
                if (!item || !hasLesson(item)) continue;

                let changed = false;

                if (blank(read(item, 'NHAN_XET_GIAO_VIEN')) && canEdit(grid, item, 'NHAN_XET_GIAO_VIEN')) {
                    const exam = EXAM_RE.test(norm(read(item, 'TEN_BAI_DAY')));
                    item.set(
                        'NHAN_XET_GIAO_VIEN',
                        exam ? 'Nghiêm túc' : PRAISES[Math.floor(Math.random() * PRAISES.length)]
                    );
                    changed = true;
                }

                for (const [field, value] of SCORES) {
                    if (blank(read(item, field)) && canEdit(grid, item, field)) {
                        await setScore(ctx, grid, item, uid, field, value);
                        changed = true;
                    }
                }

                if (changed) count++;
            }

            grid.refresh();

            alert(
                count
                    ? `✅ Đã gõ điểm xong cho ${count} tiết.\nHệ thống web đã tự động chạy tính Tổng và Xếp loại.\nHãy kiểm tra và bấm Ghi để lưu.`
                    : 'ℹ️ Không có ô trống hợp lệ để điền.'
            );
        }));

        // ==========================================
        // 2. XÁC NHẬN HOÀN THÀNH
        // ==========================================

        btnConfirm.addEventListener('click', () => run(btnConfirm, async () => {
            const ctx = getContext();
            const grid = findGrid(ctx);

            if (!grid) return confirmLegacy(ctx);

            if (!leafColumns(grid.columns).some(c => c.field === FIELD_CONFIRM)) {
                throw new Error('Bảng không có trường Xác nhận.');
            }

            grid.closeCell();

            const uids = selectedScope(grid);

            await runBatch(uids, 'Xử lý', uid => {
                if (ctx.win.document !== ctx.doc || !rootOf(grid).isConnected) {
                    throw new Error('Trang bị đổi lúc xử lý.');
                }
                return confirmRow(ctx, grid, uid);
            });
        }));

        return { show: () => { if (!wrapper.isConnected) body().appendChild(wrapper); setPanelOpen(isOpen); } };
    }
})();