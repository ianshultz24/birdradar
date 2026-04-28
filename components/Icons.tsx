import type { CSSProperties } from 'react';

interface IconProps {
  size?: number;
  style?: CSSProperties;
  className?: string;
  color?: string;
}

function Icon({ size = 18, style, className, color, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
      className={className}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(p: IconProps) {
  return <Icon {...p}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></Icon>;
}

export function XIcon(p: IconProps) {
  return <Icon {...p}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></Icon>;
}

export function BellIcon(p: IconProps) {
  return <Icon {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></Icon>;
}

export function BirdIcon(p: IconProps) {
  return <Icon {...p}><path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20"/><path d="m20 7 2 .5-2 .5"/><path d="M10 18v3"/><path d="M14 17.75V21"/><path d="M7 18a6 6 0 0 0 3.84-10.61"/></Icon>;
}

export function SettingsIcon(p: IconProps) {
  return <Icon {...p}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></Icon>;
}

export function MapPinIcon(p: IconProps) {
  return <Icon {...p}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></Icon>;
}

export function TargetIcon(p: IconProps) {
  return <Icon {...p}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></Icon>;
}

export function UploadIcon(p: IconProps) {
  return <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></Icon>;
}

export function RefreshCwIcon(p: IconProps) {
  return <Icon {...p}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></Icon>;
}

export function CheckIcon(p: IconProps) {
  return <Icon {...p}><path d="M20 6 9 17l-5-5"/></Icon>;
}

export function TrashIcon(p: IconProps) {
  return <Icon {...p}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></Icon>;
}

export function SunIcon(p: IconProps) {
  return <Icon {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></Icon>;
}

export function MoonIcon(p: IconProps) {
  return <Icon {...p}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></Icon>;
}

export function ChevronDownIcon(p: IconProps) {
  return <Icon {...p}><path d="m6 9 6 6 6-6"/></Icon>;
}

export function ChevronRightIcon(p: IconProps) {
  return <Icon {...p}><path d="m9 18 6-6-6-6"/></Icon>;
}

export function WifiIcon(p: IconProps) {
  return <Icon {...p}><path d="M5 13a10 10 0 0 1 14 0"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><line x1="12" x2="12.01" y1="20" y2="20"/></Icon>;
}

export function WifiOffIcon(p: IconProps) {
  return <Icon {...p}><line x1="2" x2="22" y1="2" y2="22"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 13a10 10 0 0 1 5.24-2.76"/><line x1="12" x2="12.01" y1="20" y2="20"/></Icon>;
}

export function Volume2Icon(p: IconProps) {
  return <Icon {...p}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></Icon>;
}

export function ListIcon(p: IconProps) {
  return <Icon {...p}><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></Icon>;
}

export function AlertCircleIcon(p: IconProps) {
  return <Icon {...p}><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></Icon>;
}

export function EyeIcon(p: IconProps) {
  return <Icon {...p}><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></Icon>;
}

export function ClockIcon(p: IconProps) {
  return <Icon {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Icon>;
}

export function NavigationIcon(p: IconProps) {
  return <Icon {...p}><polygon points="3 11 22 2 13 21 11 13 3 11"/></Icon>;
}

export function CrosshairIcon(p: IconProps) {
  return <Icon {...p}><circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/></Icon>;
}

export function PlusIcon(p: IconProps) {
  return <Icon {...p}><path d="M5 12h14"/><path d="M12 5v14"/></Icon>;
}

export function MinusIcon(p: IconProps) {
  return <Icon {...p}><path d="M5 12h14"/></Icon>;
}
