import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { useLang } from '../lib/i18n';

interface DatePickerProps {
  value: string;
  onChange: (val: string) => void;
}

type View = 'days' | 'months' | 'years';

export default function DatePicker({ value, onChange }: DatePickerProps) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; openUp: boolean } | null>(null);

  const today = new Date();
  const parsed = value ? new Date(value) : null;
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() || today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() || today.getMonth());
  const [view, setView] = useState<View>('days');
  const [yearRangeStart, setYearRangeStart] = useState(() => {
    const y = parsed?.getFullYear() || today.getFullYear();
    return y - (y % 24);
  });

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current && !ref.current.contains(target) && dropdownRef.current && !dropdownRef.current.contains(target)) {
        setOpen(false);
      }
    };
    setTimeout(() => document.addEventListener('click', handle), 0);
    return () => document.removeEventListener('click', handle);
  }, [open]);

  // Reset view to days when reopened & compute position for portal
  useEffect(() => {
    if (open) {
      setView('days');
      if (parsed) {
        setViewYear(parsed.getFullYear());
        setViewMonth(parsed.getMonth());
        setYearRangeStart(parsed.getFullYear() - (parsed.getFullYear() % 24));
      }
      // Compute dropdown position
      if (ref.current) {
        const rect = ref.current.getBoundingClientRect();
        const dropdownHeight = 370;
        const spaceBelow = window.innerHeight - rect.bottom;
        const openUp = spaceBelow < dropdownHeight;
        setPos({
          top: openUp ? rect.top : rect.bottom + 8,
          left: rect.left,
          openUp,
        });
      }
    } else {
      setPos(null);
    }
  }, [open]);

  const months = t('months');
  const weekDays = t('weekDays');
  const shortMonths = useMemo(() => months.map(m => m.slice(0, 3)), [months]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayRaw = new Date(viewYear, viewMonth, 1).getDay();
  const firstDay = firstDayRaw === 0 ? 6 : firstDayRaw - 1;

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const selectDay = (day: number) => {
    const m = String(viewMonth + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    onChange(`${viewYear}-${m}-${d}`);
    setOpen(false);
  };

  const isSelected = (day: number) => {
    if (!parsed) return false;
    return parsed.getFullYear() === viewYear && parsed.getMonth() === viewMonth && parsed.getDate() === day;
  };

  const isToday = (day: number) => {
    return today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === day;
  };

  const displayValue = parsed
    ? parsed.toLocaleDateString(useLang.getState().lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // 24 years per page
  const yearCells = useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i < 24; i++) arr.push(yearRangeStart + i);
    return arr;
  }, [yearRangeStart]);

  const handleHeaderClick = () => {
    if (view === 'days') {
      setView('months');
    } else if (view === 'months') {
      setYearRangeStart(viewYear - (viewYear % 24));
      setView('years');
    }
  };

  const selectMonth = (monthIdx: number) => {
    setViewMonth(monthIdx);
    setView('days');
  };

  const selectYear = (year: number) => {
    setViewYear(year);
    setView('months');
  };

  const headerLabel = view === 'days'
    ? `${months[viewMonth]} ${viewYear}`
    : view === 'months'
      ? `${viewYear}`
      : `${yearRangeStart} — ${yearRangeStart + 23}`;

  const handlePrev = () => {
    if (view === 'days') prevMonth();
    else if (view === 'months') setViewYear(y => y - 1);
    else setYearRangeStart(s => s - 24);
  };

  const handleNext = () => {
    if (view === 'days') nextMonth();
    else if (view === 'months') setViewYear(y => y + 1);
    else setYearRangeStart(s => s + 24);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-tertiary text-sm text-white border border-border hover:border-accent transition-colors text-left"
      >
        <Calendar size={14} className="text-zinc-500 flex-shrink-0" />
        <span className={displayValue ? 'text-white' : 'text-zinc-500'}>
          {displayValue || (lang === 'ru' ? 'дд.мм.гггг' : 'mm/dd/yyyy')}
        </span>
      </button>

      {open && createPortal(
        <AnimatePresence>
          {pos && (
            <motion.div
              ref={dropdownRef}
              initial={{ opacity: 0, y: pos.openUp ? 8 : -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: pos.openUp ? 8 : -8, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="fixed w-72 glass-strong rounded-xl shadow-2xl z-[9999] overflow-hidden border border-border"
              style={{
                left: pos.left,
                ...(pos.openUp
                  ? { bottom: window.innerHeight - pos.top + 8 }
                  : { top: pos.top }),
              }}
            >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <button type="button" onClick={handlePrev} className="p-1 rounded-lg hover:bg-surface-hover text-zinc-400 hover:text-white transition-colors">
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                onClick={handleHeaderClick}
                className={`text-sm font-medium text-white transition-colors ${view !== 'years' ? 'hover:text-accent cursor-pointer' : 'cursor-default'}`}
              >
                {headerLabel}
              </button>
              <button type="button" onClick={handleNext} className="p-1 rounded-lg hover:bg-surface-hover text-zinc-400 hover:text-white transition-colors">
                <ChevronRight size={18} />
              </button>
            </div>

            <AnimatePresence mode="wait">
              {/* ===== DAYS VIEW ===== */}
              {view === 'days' && (
                <motion.div
                  key="days"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.12 }}
                >
                  <div className="grid grid-cols-7 px-3 pt-2">
                    {weekDays.map((d) => (
                      <div key={d} className="text-center text-[11px] text-zinc-500 font-medium py-1">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 px-3 pb-2">
                    {cells.map((day, i) => (
                      <div key={i} className="flex items-center justify-center">
                        {day ? (
                          <button
                            type="button"
                            onClick={() => selectDay(day)}
                            className={`w-8 h-8 rounded-full text-sm flex items-center justify-center transition-all ${
                              isSelected(day)
                                ? 'bg-accent text-white font-semibold shadow-lg shadow-accent/30'
                                : isToday(day)
                                  ? 'text-vortex-400 font-semibold ring-1 ring-vortex-500/50'
                                  : 'text-zinc-300 hover:bg-surface-hover'
                            }`}
                          >
                            {day}
                          </button>
                        ) : (
                          <span className="w-8 h-8" />
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* ===== MONTHS VIEW ===== */}
              {view === 'months' && (
                <motion.div
                  key="months"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.12 }}
                  className="grid grid-cols-3 gap-1 p-3"
                >
                  {shortMonths.map((m, idx) => {
                    const isCurrentMonth = viewYear === today.getFullYear() && idx === today.getMonth();
                    const isSelectedMonth = parsed && viewYear === parsed.getFullYear() && idx === parsed.getMonth();
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => selectMonth(idx)}
                        className={`py-2.5 rounded-lg text-sm font-medium transition-all ${
                          isSelectedMonth
                            ? 'bg-accent text-white shadow-lg shadow-accent/30'
                            : isCurrentMonth
                              ? 'text-vortex-400 ring-1 ring-vortex-500/50'
                              : 'text-zinc-300 hover:bg-surface-hover'
                        }`}
                      >
                        {m}
                      </button>
                    );
                  })}
                </motion.div>
              )}

              {/* ===== YEARS VIEW ===== */}
              {view === 'years' && (
                <motion.div
                  key="years"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.12 }}
                  className="grid grid-cols-4 gap-1 p-3"
                >
                  {yearCells.map((yr) => {
                    const isCurrentYear = yr === today.getFullYear();
                    const isSelectedYear = parsed && yr === parsed.getFullYear();
                    return (
                      <button
                        key={yr}
                        type="button"
                        onClick={() => selectYear(yr)}
                        className={`py-2 rounded-lg text-sm font-medium transition-all ${
                          isSelectedYear
                            ? 'bg-accent text-white shadow-lg shadow-accent/30'
                            : isCurrentYear
                              ? 'text-vortex-400 ring-1 ring-vortex-500/50'
                              : 'text-zinc-300 hover:bg-surface-hover'
                        }`}
                      >
                        {yr}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-border">
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {t('clear')}
              </button>
              <button
                type="button"
                onClick={() => {
                  const m = String(today.getMonth() + 1).padStart(2, '0');
                  const d = String(today.getDate()).padStart(2, '0');
                  onChange(`${today.getFullYear()}-${m}-${d}`);
                  setOpen(false);
                }}
                className="text-xs text-vortex-400 hover:text-vortex-300 transition-colors"
              >
                {t('today')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body)}
    </div>
  );
}
