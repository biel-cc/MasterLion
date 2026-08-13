'use client';

import { Modal, Text } from '@lobehub/ui';
import { App, Form, Input, Select } from 'antd';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaClient } from '@/libs/trpc/client';

interface SubmitMcpModalProps {
  beforeSubmit?: () => Promise<{ actAs?: number } | void>;
  onClose: () => void;
  onSuccess?: () => void;
  open: boolean;
}

const SubmitMcpModal = memo<SubmitMcpModalProps>(({ beforeSubmit, onClose, onSuccess, open }) => {
  const { message } = App.useApp();
  const { t } = useTranslation('discover');
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      const values = await form.validateFields();
      const context = await beforeSubmit?.();
      await lambdaClient.market.socialProfile.submitMcp.mutate({
        actAs: context?.actAs,
        authType: values.authType,
        description: values.description.trim(),
        name: values.name.trim(),
        url: values.url.trim(),
      });
      message.success(t('user.submitMcpSuccess'));
      form.resetFields();
      onSuccess?.();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('user.submitMcpError'));
    } finally {
      setSubmitting(false);
    }
  }, [beforeSubmit, form, message, onClose, onSuccess, t]);

  return (
    <Modal
      centered
      confirmLoading={submitting}
      open={open}
      title={false}
      width={480}
      onCancel={onClose}
      onOk={handleSubmit}
    >
      <Text strong fontSize={20} style={{ display: 'block', marginBottom: 16, marginTop: 16 }}>
        {t('user.submitMcpTitle')}
      </Text>
      <Form form={form} initialValues={{ authType: 'none' }} layout="vertical">
        <Form.Item label={t('user.mcpName')} name="name" rules={[{ required: true }]}>
          <Input maxLength={80} />
        </Form.Item>
        <Form.Item label={t('user.mcpDescription')} name="description" rules={[{ required: true }]}>
          <Input.TextArea showCount maxLength={500} rows={3} />
        </Form.Item>
        <Form.Item
          label={t('user.mcpUrl')}
          name="url"
          rules={[{ required: true }, { pattern: /^https:\/\//, message: t('user.mcpUrlHttps') }]}
        >
          <Input placeholder="https://example.com/mcp" />
        </Form.Item>
        <Form.Item label={t('user.mcpAuth')} name="authType">
          <Select
            options={[
              { label: t('user.mcpAuthNone'), value: 'none' },
              { label: 'OAuth 2.0', value: 'oauth2' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
});

SubmitMcpModal.displayName = 'SubmitMcpModal';

export default SubmitMcpModal;
