import { useState, useEffect } from 'react';
import { BarChart2, CheckCircle2, Circle } from 'lucide-react';
import { api } from '../lib/api';
import type { Poll } from '../lib/types';

interface PollMessageProps {
  messageId: string;
  isMine: boolean;
}

export default function PollMessage({ messageId, isMine }: PollMessageProps) {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    api.getPoll(messageId)
      .then(setPoll)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [messageId]);

  const handleVote = async (optionId: string) => {
    if (!poll || voting) return;
    setVoting(true);
    try {
      let newVotes: string[];
      if (poll.multipleChoice) {
        newVotes = poll.myVotes.includes(optionId)
          ? poll.myVotes.filter(id => id !== optionId)
          : [...poll.myVotes, optionId];
      } else {
        newVotes = poll.myVotes.includes(optionId) ? [] : [optionId];
      }
      const result = await api.votePoll(messageId, newVotes);
      setPoll(prev => prev ? {
        ...prev,
        options: prev.options.map(o => {
          const updated = result.options.find(r => r.id === o.id);
          return updated ? { ...o, votes: updated.votes } : o;
        }),
        totalVotes: result.totalVotes,
        myVotes: result.myVotes,
      } : prev);
    } catch (e) {
      console.error('Vote error:', e);
    } finally {
      setVoting(false);
    }
  };

  if (loading) return (
    <div className="min-w-[220px] py-2">
      <div className="h-4 bg-white/10 rounded animate-pulse mb-2" />
      <div className="h-3 bg-white/5 rounded animate-pulse" />
    </div>
  );

  if (!poll) return null;

  const maxVotes = Math.max(...poll.options.map(o => o.votes), 1);

  return (
    <div className="min-w-[240px] max-w-[320px]">
      <div className="flex items-center gap-2 mb-3">
        <BarChart2 size={16} className={isMine ? 'text-white/70' : 'text-blue-400'} />
        <p className="text-sm font-semibold">{poll.question}</p>
      </div>

      <div className="space-y-2">
        {poll.options.map(option => {
          const isVoted = poll.myVotes.includes(option.id);
          const pct = poll.totalVotes > 0 ? Math.round((option.votes / poll.totalVotes) * 100) : 0;

          return (
            <button
              key={option.id}
              onClick={() => handleVote(option.id)}
              disabled={voting}
              className={`w-full text-left relative rounded-xl overflow-hidden transition-all ${
                isVoted
                  ? isMine ? 'ring-2 ring-white/40' : 'ring-2 ring-blue-400/60'
                  : 'hover:brightness-110'
              }`}
            >
              {/* Progress bar background */}
              <div
                className={`absolute inset-0 rounded-xl transition-all duration-500 ${
                  isMine ? 'bg-white/20' : 'bg-blue-500/20'
                }`}
                style={{ width: `${pct}%` }}
              />
              <div className={`relative flex items-center justify-between px-3 py-2 rounded-xl ${
                isMine ? 'bg-white/10' : 'bg-white/5'
              }`}>
                <div className="flex items-center gap-2 min-w-0">
                  {isVoted
                    ? <CheckCircle2 size={14} className={isMine ? 'text-white flex-shrink-0' : 'text-blue-400 flex-shrink-0'} />
                    : <Circle size={14} className="text-white/30 flex-shrink-0" />
                  }
                  <span className="text-sm truncate">{option.text}</span>
                </div>
                <span className={`text-xs font-medium ml-2 flex-shrink-0 ${isMine ? 'text-white/70' : 'text-zinc-400'}`}>
                  {pct}%
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <p className={`text-xs mt-2 ${isMine ? 'text-white/50' : 'text-zinc-500'}`}>
        {poll.totalVotes} {poll.totalVotes === 1 ? 'голос' : poll.totalVotes < 5 ? 'голоса' : 'голосов'}
        {poll.multipleChoice && ' · Несколько вариантов'}
      </p>
    </div>
  );
}
