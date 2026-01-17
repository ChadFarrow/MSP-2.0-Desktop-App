import type { ValueRecipient } from '../types/feed';

export interface PresetRecipient {
  label: string;
  recipient: ValueRecipient;
}

export const PRESET_RECIPIENTS: PresetRecipient[] = [
  { label: 'MSP 2.0', recipient: { name: 'MSP 2.0', address: 'chadf@getalby.com', split: 1, type: 'lnaddress' } },
  { label: 'Podcastindex.org', recipient: { name: 'Podcastindex.org', address: 'podcastindex@getalby.com', split: 1, type: 'lnaddress' } },
];
