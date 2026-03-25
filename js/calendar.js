/**
 * Month calendar sidebar — selects view date
 */
(function () {
  "use strict";

  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toKey(y, m, d) {
    return `${y}-${pad(m + 1)}-${pad(d)}`;
  }

  function parseKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return { y, m: m - 1, d };
  }

  function daysInMonth(y, m) {
    return new Date(y, m + 1, 0).getDate();
  }

  function firstWeekday(y, m) {
    return new Date(y, m, 1).getDay();
  }

  function todayKey() {
    const x = new Date();
    return toKey(x.getFullYear(), x.getMonth(), x.getDate());
  }

  /**
   * @param {{ container: HTMLElement, onSelect: (dateKey: string) => void, getDots?: (dateKey: string) => boolean }}
   */
  function init(options) {
    const { container, onSelect, getDots, onMonthChange } = options;
    let viewYear = new Date().getFullYear();
    let viewMonth = new Date().getMonth();
    let selectedKey = todayKey();

    const head = document.createElement("div");
    head.className = "cal-head";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "cal-nav";
    prev.setAttribute("aria-label", "Previous month");
    prev.textContent = "‹";

    const title = document.createElement("h2");
    title.className = "cal-title";

    const next = document.createElement("button");
    next.type = "button";
    next.className = "cal-nav";
    next.setAttribute("aria-label", "Next month");
    next.textContent = "›";

    const weekRow = document.createElement("div");
    weekRow.className = "cal-weekdays";
    ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].forEach((w) => {
      const s = document.createElement("span");
      s.textContent = w;
      weekRow.appendChild(s);
    });

    const grid = document.createElement("div");
    grid.className = "cal-grid";

    head.appendChild(prev);
    head.appendChild(title);
    head.appendChild(next);

    container.appendChild(head);
    container.appendChild(weekRow);
    container.appendChild(grid);

    function render() {
      title.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
      grid.innerHTML = "";

      const dim = daysInMonth(viewYear, viewMonth);
      const start = firstWeekday(viewYear, viewMonth);
      const tk = todayKey();

      for (let i = 0; i < start; i++) {
        const cell = document.createElement("div");
        cell.className = "cal-cell cal-cell--empty";
        grid.appendChild(cell);
      }

      for (let d = 1; d <= dim; d++) {
        const key = toKey(viewYear, viewMonth, d);
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cal-cell cal-cell--day";
        if (key === tk) cell.classList.add("cal-cell--today");
        if (key === selectedKey) cell.classList.add("cal-cell--selected");

        const num = document.createElement("span");
        num.className = "cal-day-num";
        num.textContent = String(d);
        cell.appendChild(num);

        if (getDots && getDots(key)) {
          const dot = document.createElement("span");
          dot.className = "cal-dot";
          cell.appendChild(dot);
        }

        cell.addEventListener("click", () => {
          selectedKey = key;
          render();
          onSelect(key);
        });

        grid.appendChild(cell);
      }
    }

    prev.addEventListener("click", () => {
      viewMonth--;
      if (viewMonth < 0) {
        viewMonth = 11;
        viewYear--;
      }
      render();
      if (typeof onMonthChange === "function") onMonthChange();
    });

    next.addEventListener("click", () => {
      viewMonth++;
      if (viewMonth > 11) {
        viewMonth = 0;
        viewYear++;
      }
      render();
      if (typeof onMonthChange === "function") onMonthChange();
    });

    render();

    return {
      getRange() {
        const first = `${viewYear}-${pad(viewMonth + 1)}-01`;
        const lastD = daysInMonth(viewYear, viewMonth);
        const last = `${viewYear}-${pad(viewMonth + 1)}-${pad(lastD)}`;
        return { start: first, end: last };
      },
      setSelectedKey(key) {
        selectedKey = key;
        const p = parseKey(key);
        viewYear = p.y;
        viewMonth = p.m;
        render();
      },
      getSelectedKey() {
        return selectedKey;
      },
      refresh() {
        render();
      },
      showMonth(y, m) {
        viewYear = y;
        viewMonth = m;
        render();
      },
    };
  }

  window.DGT_Calendar = { init, todayKey, toKey };
})();
