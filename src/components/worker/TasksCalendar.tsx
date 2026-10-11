import React, { useMemo, useState } from "react";
import type { TaskRow } from "@/lib/worker/tasks";

type Props = {
  tasks: TaskRow[];
  selectedDate: Date | null;
  onSelectDate: (d: Date | null) => void;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function TasksCalendar({ tasks, selectedDate, onSelectDate }: Props) {
  // Use selectedDate for current month view, or fallback to today
  const cursorDate = selectedDate || new Date();
  const [viewMonth, setViewMonth] = useState(new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1));

  // Determine dots for this month
  const datesWithTasks = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const val = t.dueDate as any;
      const d = typeof val.toDate === "function" ? val.toDate() : new Date(val);
      set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
    return set;
  }, [tasks]);

  // Build grid
  const daysInGrid = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    
    // First day of this month
    const firstDay = new Date(year, month, 1);
    // Last day of this month
    const lastDay = new Date(year, month + 1, 0);

    // Day of week index (0=Sun, 1=Mon, etc) -> Re-map to 0=Mon, 6=Sun
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6; // Sunday becomes 6

    const cells: { date: Date | null; isCurrentMonth: boolean; hasTask: boolean; isToday: boolean }[] = [];
    const today = new Date();

    // Padding before
    for (let i = 0; i < startOffset; i++) {
        const d = new Date(year, month, 1 - (startOffset - i));
        const isToday = d.toDateString() === today.toDateString();
        cells.push({ date: d, isCurrentMonth: false, hasTask: false, isToday });
    }

    // Actual days
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const d = new Date(year, month, i);
      const key = `${year}-${month}-${i}`;
      const isToday = d.toDateString() === today.toDateString();
      cells.push({ date: d, isCurrentMonth: true, hasTask: datesWithTasks.has(key), isToday });
    }

    // Padding after to complete rows (7 cols)
    const remainder = cells.length % 7;
    if (remainder > 0) {
        const toAdd = 7 - remainder;
        for (let i = 1; i <= toAdd; i++) {
            const d = new Date(year, month + 1, i);
            const isToday = d.toDateString() === today.toDateString();
            cells.push({ date: d, isCurrentMonth: false, hasTask: false, isToday });
        }
    }

    return cells;
  }, [viewMonth, datesWithTasks]);

  const prevMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1));
  const nextMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1));

  return (
    <div className="ui-card p-6 flex flex-col mb-4">
      {/* Header */}
      <div className="flex justify-between items-center mb-5 pb-4 border-b border-[var(--mft-border)]">
        <button 
          onClick={prevMonth} 
          className="p-2 rounded-lg border border-[var(--mft-border)] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1 text-xs font-semibold"
          title="Previous Month"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="hidden sm:inline">Prev</span>
        </button>
        <div className="text-center">
          <span className="font-heading font-semibold text-lg text-zinc-900 dark:text-zinc-100">
            {viewMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
          </span>
          <p className="text-[11px] text-zinc-500 font-mono uppercase tracking-wider">Task Due Dates</p>
        </div>
        <button 
          onClick={nextMonth} 
          className="p-2 rounded-lg border border-[var(--mft-border)] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1 text-xs font-semibold"
          title="Next Month"
        >
          <span className="hidden sm:inline">Next</span>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Days Row */}
      <div className="grid grid-cols-7 mb-2">
        {DAY_NAMES.map(name => (
          <div key={name} className="text-center font-mono text-[11px] font-semibold text-zinc-500 uppercase tracking-wider py-1">
            {name}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-y-2 gap-x-1 sm:gap-x-2 relative">
        {daysInGrid.map((bgDay, i) => {
            const { date, isCurrentMonth, hasTask, isToday } = bgDay;
            if (!date) return <div key={i} />

            // Is selected?
            const isSelected = selectedDate && selectedDate.getFullYear() === date.getFullYear() &&
                               selectedDate.getMonth() === date.getMonth() &&
                               selectedDate.getDate() === date.getDate();

            return (
                <div key={i} className="flex flex-col items-center min-h-[52px]">
                    <button 
                        onClick={() => onSelectDate(isSelected ? null : date)}
                        className={`
                            relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center font-mono text-xs sm:text-sm font-medium transition-all duration-150
                            ${isSelected 
                              ? "bg-red-600 text-white font-bold shadow-md shadow-red-600/30 ring-2 ring-red-500/40 scale-105" 
                              : isToday
                                ? "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 font-bold border border-red-500/30 hover:bg-red-100 dark:hover:bg-red-950/70"
                                : "text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
                            }
                            ${!isCurrentMonth && !isSelected ? "opacity-35" : ""}
                        `}
                    >
                        {date.getDate()}
                    </button>
                    {/* Activity Dot underneath */}
                    <div className="h-2 w-full flex justify-center mt-1">
                        {hasTask && (
                            <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-red-600" : "bg-red-500 dark:bg-red-400"} animate-pulse`} />
                        )}
                    </div>
                </div>
            )
        })}
      </div>
      
      {/* Clear Action */}
      <div className="mt-4 pt-3 border-t border-[var(--mft-border)] flex justify-between items-center text-xs">
        <span className="font-mono text-zinc-500 flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${selectedDate ? "bg-red-500" : "bg-zinc-400"}`} />
          {selectedDate ? `Filtering: ${selectedDate.toLocaleDateString()}` : "Showing all deadlines"}
        </span>
        {selectedDate && (
          <button 
            onClick={() => onSelectDate(null)} 
            className="text-red-600 dark:text-red-400 font-semibold hover:underline flex items-center gap-1"
          >
            Clear Filter
          </button>
        )}
      </div>
    </div>
  );
}
