import { useState } from 'react';
import type { Person } from '../../types/feed';
import type { FeedAction } from '../../store/feedStore';
import { PERSON_GROUPS, PERSON_ROLES, createEmptyPersonRole } from '../../types/feed';
import type { PersonGroup } from '../../types/feed';
import { FIELD_INFO } from '../../data/fieldInfo';
import { InfoIcon } from '../InfoIcon';
import { Section } from '../Section';
import { RolesModal } from '../modals/RolesModal';

interface CreditsSectionProps {
  persons: Person[];
  dispatch: React.Dispatch<FeedAction>;
}

export function CreditsSection({ persons, dispatch }: CreditsSectionProps) {
  const [showRolesModal, setShowRolesModal] = useState(false);

  return (
    <>
      <Section title="Credits / Persons" icon="&#128100;">
        <div className="repeatable-list">
          {persons.map((person, personIndex) => (
            <div key={personIndex} className="repeatable-item">
              <div className="repeatable-item-content">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Name<InfoIcon text={FIELD_INFO.personName} /></label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Person name"
                      value={person.name || ''}
                      onChange={e => dispatch({
                        type: 'UPDATE_PERSON',
                        payload: { index: personIndex, person: { ...person, name: e.target.value } }
                      })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Website<InfoIcon text={FIELD_INFO.personHref} /></label>
                    <input
                      type="url"
                      className="form-input"
                      placeholder="https://..."
                      value={person.href || ''}
                      onChange={e => dispatch({
                        type: 'UPDATE_PERSON',
                        payload: { index: personIndex, person: { ...person, href: e.target.value } }
                      })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Photo URL<InfoIcon text={FIELD_INFO.personImg} /></label>
                    <input
                      type="url"
                      className="form-input"
                      placeholder="https://..."
                      value={person.img || ''}
                      onChange={e => dispatch({
                        type: 'UPDATE_PERSON',
                        payload: { index: personIndex, person: { ...person, img: e.target.value } }
                      })}
                    />
                  </div>
                </div>

                {/* Two-column layout: Roles (left) + Thumbnail Preview (right) */}
                <div className="person-preview-container" style={{ marginTop: '16px', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  {/* Left column: Roles section */}
                  <div className="person-roles-section" style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                      <label className="form-label" style={{ margin: 0 }}>Roles<InfoIcon text={FIELD_INFO.personRole} /></label>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '14px', padding: '8px 16px' }}
                        onClick={() => setShowRolesModal(true)}
                      >
                        View All Roles
                      </button>
                    </div>
                    <div className="person-roles-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
                      {person.roles.map((role, roleIndex) => (
                        <div key={roleIndex} className="person-role-item" style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          background: 'var(--bg-tertiary)',
                          padding: '8px 12px',
                          borderRadius: '6px',
                          fontSize: '14px'
                        }}>
                          <select
                            className="form-select"
                            style={{ minWidth: '180px', padding: '8px 12px', fontSize: '14px' }}
                            value={role.group}
                            onChange={e => {
                              const newGroup = e.target.value as PersonGroup;
                              const newRole = PERSON_ROLES[newGroup]?.[0]?.value || 'band';
                              dispatch({
                                type: 'UPDATE_PERSON_ROLE',
                                payload: { personIndex, roleIndex, role: { group: newGroup, role: newRole } }
                              });
                            }}
                          >
                            {PERSON_GROUPS.map(g => (
                              <option key={g.value} value={g.value}>{g.label}</option>
                            ))}
                          </select>
                          <select
                            className="form-select"
                            style={{ minWidth: '200px', padding: '8px 12px', fontSize: '14px' }}
                            value={role.role}
                            onChange={e => dispatch({
                              type: 'UPDATE_PERSON_ROLE',
                              payload: { personIndex, roleIndex, role: { ...role, role: e.target.value } }
                            })}
                          >
                            {(PERSON_ROLES[role.group] || PERSON_ROLES.music).map(r => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                          {person.roles.length > 1 && (
                            <button
                              className="btn btn-icon btn-danger"
                              style={{ padding: '6px 10px', fontSize: '14px', minWidth: 'auto' }}
                              onClick={() => dispatch({
                                type: 'REMOVE_PERSON_ROLE',
                                payload: { personIndex, roleIndex }
                              })}
                              title="Remove role"
                            >
                              &#10005;
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '12px', padding: '4px 12px' }}
                      onClick={() => dispatch({
                        type: 'ADD_PERSON_ROLE',
                        payload: { personIndex, role: createEmptyPersonRole() }
                      })}
                    >
                      + Add Role
                    </button>
                  </div>
                  {/* Right column: Thumbnail preview */}
                  <div className="person-thumbnail-preview" style={{
                    width: '140px',
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <div style={{
                      width: '100%',
                      ...(!person.img && { aspectRatio: '1' }),
                      borderRadius: '8px',
                      overflow: 'hidden',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {person.img ? (
                        <img
                          src={person.img}
                          alt={person.name || 'Person thumbnail'}
                          style={{
                            width: '100%',
                            display: 'block'
                          }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                          onLoad={(e) => {
                            (e.target as HTMLImageElement).style.display = 'block';
                          }}
                        />
                      ) : (
                        <span style={{
                          fontSize: '48px',
                          color: 'var(--text-muted)'
                        }}>
                          &#128100;
                        </span>
                      )}
                    </div>
                    <span style={{
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      textAlign: 'center',
                      width: '100%'
                    }}>
                      {person.img ? 'Photo' : 'No photo'}
                    </span>
                  </div>
                </div>
                {/* Close two-column container */}
              </div>
              <div className="repeatable-item-actions">
                <button
                  className="btn btn-icon btn-danger"
                  onClick={() => dispatch({ type: 'REMOVE_PERSON', payload: personIndex })}
                >
                  &#10005;
                </button>
              </div>
            </div>
          ))}
          <button className="add-item-btn" onClick={() => dispatch({ type: 'ADD_PERSON' })}>
            + Add Person
          </button>
        </div>
      </Section>
      <RolesModal isOpen={showRolesModal} onClose={() => setShowRolesModal(false)} />
    </>
  );
}
