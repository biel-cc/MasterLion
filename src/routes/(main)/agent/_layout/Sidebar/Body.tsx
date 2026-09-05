import { Accordion, Flexbox } from '@lobehub/ui';
import React, { memo } from 'react';

import TaskList from './Task';
import Topic from './Topic';

export enum ChatSidebarKey {
  Tasks = 'tasks',
  Topic = 'topic',
}

/**
 * Sidebar body. Task keeps its stable reserved position above Topic even while
 * task support is not yet exposed. Both modules retain their existing logic.
 */
const Body = memo(() => {
  return (
    <Flexbox paddingInline={4}>
      <Accordion defaultExpandedKeys={[ChatSidebarKey.Topic]} gap={8}>
        <TaskList itemKey={ChatSidebarKey.Tasks} />
        <Topic itemKey={ChatSidebarKey.Topic} />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
