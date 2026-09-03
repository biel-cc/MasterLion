import { Accordion, Flexbox } from '@lobehub/ui';
import React, { memo } from 'react';

import TaskList from './Task';
import Topic from './Topic';

export enum ChatSidebarKey {
  Tasks = 'tasks',
  Topic = 'topic',
}

/**
 * Sidebar body. Topic is the primary navigation and sits above Task: Task is
 * an independent managed-execution module and keeps its own implementation,
 * props and item key untouched — only the presentation order changed.
 */
const Body = memo(() => {
  return (
    <Flexbox paddingInline={4}>
      <Accordion defaultExpandedKeys={[ChatSidebarKey.Topic]} gap={8}>
        <Topic itemKey={ChatSidebarKey.Topic} />
        <TaskList itemKey={ChatSidebarKey.Tasks} />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
