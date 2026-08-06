import type { BuiltinSkill } from '@lobechat/types';

import { toResourceMeta } from '../lobehub/helpers';
import excel from './references/excel.md';
import powerpoint from './references/powerpoint.md';
import word from './references/word.md';
import content from './SKILL.md';

export const OfficeDocumentsIdentifier = 'office-documents';

export const OfficeDocumentsSkill: BuiltinSkill = {
  avatar: '📄',
  content,
  description:
    'Create, fill, inspect, validate, preview, and export Word, Excel, and PowerPoint files with Masterino Office tools.',
  identifier: OfficeDocumentsIdentifier,
  name: 'Office Documents',
  resources: toResourceMeta({
    'references/excel': excel,
    'references/powerpoint': powerpoint,
    'references/word': word,
  }),
  source: 'builtin',
};
