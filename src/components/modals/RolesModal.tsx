import { PERSON_GROUPS, PERSON_ROLES } from '../../types/feed';
import { ModalWrapper } from './ModalWrapper';

interface RolesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RolesModal({ isOpen, onClose }: RolesModalProps) {
  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      title="Podcasting 2.0 Roles Reference"
      style={{ zIndex: 1000 }}
    >
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
        Full list of groups and roles from the Podcasting 2.0 taxonomy, plus custom music roles.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
        {PERSON_GROUPS.map(group => (
          <div key={group.value} style={{
            background: 'var(--bg-tertiary)',
            borderRadius: '8px',
            padding: '16px'
          }}>
            <h4 style={{ margin: '0 0 12px 0', color: 'var(--accent-primary)', fontSize: '14px', textTransform: 'uppercase' }}>
              {group.label}
            </h4>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {PERSON_ROLES[group.value].map(role => (
                <li key={role.value} style={{ color: 'var(--text-primary)', padding: '4px 0', fontSize: '13px' }}>
                  {role.label}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </ModalWrapper>
  );
}
