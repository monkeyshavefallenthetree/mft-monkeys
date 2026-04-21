import React, { useMemo, useState } from "react";
import type { TaskRow } from "@/lib/worker/tasks";

type Props = {
  tasks: TaskRow[];
  selectedDate: Date | null;
  onSelectDate: (d: Date | null) => void;
};

const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

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

    const cells: { date: Date | null; isCurrentMonth: boolean; hasTask: boolean }[] = [];

    // Padding before
    for (let i = 0; i < startOffset; i++) {
        const d = new Date(year, month, 1 - (startOffset - i));
        cells.push({ date: d, isCurrentMonth: false, hasTask: false });
    }

    // Actual days
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const d = new Date(year, month, i);
      const key = `${year}-${month}-${i}`;
      cells.push({ date: d, isCurrentMonth: true, hasTask: datesWithTasks.has(key) });
    }

    // Padding after to complete rows (7 cols)
    const remainder = cells.length % 7;
    if (remainder > 0) {
        const toAdd = 7 - remainder;
        for (let i = 1; i <= toAdd; i++) {
            const d = new Date(year, month + 1, i);
            cells.push({ date: d, isCurrentMonth: false, hasTask: false });
        }
    }

    return cells;
  }, [viewMonth, datesWithTasks]);

  const prevMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1));
  const nextMonth = () => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1));

  return (
    <div className="brutal-card p-6 flex flex-col mb-4">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <button onClick={prevMonth} className="text-white hover:text-[#FF5500] font-mono mx-2">
          &lt; PREV
        </button>
        <span className="font-oswald text-xl tracking-widest uppercase text-[#FF5500]">
          {viewMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
        </span>
        <button onClick={nextMonth} className="text-white hover:text-[#FF5500] font-mono mx-2">
          NEXT &gt;
        </button>
      </div>

      {/* Days Row */}
      <div className="grid grid-cols-7 mb-4">
        {DAY_NAMES.map(name => (
          <div key={name} className="text-center font-mono text-xs font-bold text-[#666666] tracking-widest">
            {name}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-y-4 gap-x-2 relative">
        {daysInGrid.map((bgDay, i) => {
            const { date, isCurrentMonth, hasTask } = bgDay;
            if (!date) return <div key={i} />

            // Is selected?
            const isSelected = selectedDate && selectedDate.getFullYear() === date.getFullYear() &&
                               selectedDate.getMonth() === date.getMonth() &&
                               selectedDate.getDate() === date.getDate();

            
            return (
                <div key={i} className="flex flex-col items-center min-h-[48px]">
                    <button 
                        onClick={() => onSelectDate(isSelected ? null : date)}
                        className={`
                            relative w-10 h-10 flex items-center justify-center font-mono text-sm leading-none bg-transparent hover:bg-[#333333] transition-colors
                            ${isSelected ? "bg-[#FF5500] hover:bg-[#FF5500] text-black font-bold outline-none ring-2 ring-white ring-offset-2 ring-offset-black" : "text-white"}
                            ${!isCurrentMonth && !isSelected ? "opacity-30" : ""}
                        `}
                        style={{
                            borderRadius: isSelected ? '8px' : '0px'
                        }}
                    >
                        {date.getDate()}
                    </button>
                    {/* Activity Dot underneath */}
                    <div className="h-2 w-full flex justify-center mt-1">
                        {hasTask && (
                            <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-white" : "bg-[#FF5500]"}`} />
                        )}
                    </div>
                </div>
            )
        })}
      </div>
      
      {/* Clear Action (optional context) */}
      <div className="mt-4 flex justify-between items-center">
        <span className="font-mono text-xs text-[#666666] uppercase">
             {selectedDate ? "FILTERING BY DATE" : "SHOWING ALL"}
        </span>
        {selectedDate && (
            <button onClick={() => onSelectDate(null)} className="font-mono text-xs text-white underline hover:text-[#FF5500]">
                CLEAR FILTER
            </button>
        )}
      </div>

    </div>
  );
}
