import { memo, useState } from 'react';
import { getInitials, generateAvatarColor } from '../lib/utils';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  online?: boolean;
}

const sizeClasses = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-20 h-20 text-xl',
} as const;

const onlineDotSize = {
  xs: 'w-1.5 h-1.5 border',
  sm: 'w-2 h-2 border',
  md: 'w-2.5 h-2.5 border-2',
  lg: 'w-3 h-3 border-2',
  xl: 'w-4 h-4 border-2',
} as const;

function AvatarInner({ src, name, size = 'md', className = '', online }: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const sizeClass = sizeClasses[size];
  const initials = getInitials(name || '?');
  const gradientClass = generateAvatarColor(name || '');

  const showFallback = !src || imgError;

  return (
    <div className={`relative shrink-0 ${className}`}>
      {showFallback ? (
        <div
          className={`${sizeClass} rounded-full bg-gradient-to-br ${gradientClass} flex items-center justify-center text-white font-medium`}
          aria-label={name}
          role="img"
        >
          {initials}
        </div>
      ) : (
        <img
          src={src}
          alt={name}
          loading="lazy"
          decoding="async"
          className={`${sizeClass} rounded-full object-cover`}
          onError={() => setImgError(true)}
        />
      )}
      {online !== undefined && (
        <div
          className={`absolute bottom-0 right-0 ${onlineDotSize[size]} rounded-full border-surface ${
            online ? 'bg-emerald-500' : 'bg-zinc-500'
          }`}
          aria-label={online ? 'Online' : 'Offline'}
        />
      )}
    </div>
  );
}

const Avatar = memo(AvatarInner);
export default Avatar;
