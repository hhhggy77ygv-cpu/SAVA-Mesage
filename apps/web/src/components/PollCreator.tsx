import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Trash2, BarChart2 } from 'lucide-react';

interface PollCreatorProps {
  onClose: () => void;
  onSubmit: (question: string, options: { id: string; text: string }[], multipleChoice: boolean) => void;
}

export default function PollCreator({ onClose, onSubmit }: PollCreatorProps) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState([
    { id: crypto.randomUUID(), text: '' },
    { id: crypto.randomUUID(), text: '' },
  ]);
  const [multipleChoice, setMultipleChoice] = useState(false);

  const addOption = () => {
    if (options.length >= 10) return;
    setOptions(prev => [...prev, { id: crypto.randomUUID(), text: '' }]);
  };

  const removeOption = (id: string) => {
    if (options.length <= 2) return;
    setOptions(prev => prev.filter(o => o.id !== id));
  };

  const updateOption = (id: string, text: string) => {
    setOptions(prev => prev.map(o => o.id === id ? { ...o, text } : o));
  };

  const handleSubmit = () => {
    const q = question.trim();
    const opts = options.filter(o => o.text.trim());
    if (!q || opts.length < 2) return;
    onSubmit(q, opts, multipleChoice);
    onClose();
  };

  const isValid = question.trim() && options.filter(o => o.text.trim()).length >= 2;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 10 }}
      className="absolute bottom-[calc(100%+12px)] left-0 w-80 rounded-2xl glass-strong shadow-2xl z-50 border border-white/10 backdrop-blur-3xl overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <BarChart2 size={16} className="text-blue-400" />
          <span className="text-sm font-semibold text-white">Создать опрос</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
        <input
          type="text"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Вопрос..."
          maxLength={200}
          className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-zinc-500 focus:border-blue-500 outline-none"
        />

        <div className="space-y-2">
          {options.map((opt, i) => (
            <div key={opt.id} className="flex items-center gap-2">
              <input
                type="text"
                value={opt.text}
                onChange={e => updateOption(opt.id, e.target.value)}
                placeholder={`Вариант ${i + 1}`}
                maxLength={100}
                className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-zinc-500 focus:border-blue-500 outline-none"
              />
              {options.length > 2 && (
                <button onClick={() => removeOption(opt.id)} className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        {options.length < 10 && (
          <button onClick={addOption} className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors">
            <Plus size={14} />
            Добавить вариант
          </button>
        )}

        <label className="flex items-center gap-2 cursor-pointer">
          <div
            onClick={() => setMultipleChoice(v => !v)}
            className={`w-9 h-5 rounded-full transition-colors relative ${multipleChoice ? 'bg-blue-500' : 'bg-white/10'}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${multipleChoice ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
          <span className="text-xs text-zinc-300">Несколько вариантов</span>
        </label>
      </div>

      <div className="px-4 pb-4">
        <button
          onClick={handleSubmit}
          disabled={!isValid}
          className="w-full py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-semibold transition-colors"
        >
          Создать опрос
        </button>
      </div>
    </motion.div>
  );
}
