import { ModalWrapper } from './ModalWrapper';

type ConfirmVariant = 'warning' | 'danger' | 'default';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
  onConfirm: () => void;
  onCancel: () => void;
}

const getVariantConfig = (variant: ConfirmVariant) => {
  switch (variant) {
    case 'warning':
      return {
        icon: '⚠️',
        buttonClass: 'btn-warning',
        accentColor: '#ff9800'
      };
    case 'danger':
      return {
        icon: '🗑️',
        buttonClass: 'btn-danger',
        accentColor: '#dc3545'
      };
    default:
      return {
        icon: null,
        buttonClass: 'btn-primary',
        accentColor: '#5c3cff'
      };
  }
};

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const config = getVariantConfig(variant);

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      className="confirm-modal"
      footer={
        <div className="confirm-modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            className={`btn ${config.buttonClass}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      }
    >
      <div className={`confirm-modal-content confirm-modal-${variant}`}>
        {config.icon && <div className="confirm-modal-icon">{config.icon}</div>}
        <p>{message}</p>
      </div>
    </ModalWrapper>
  );
}
