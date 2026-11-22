/**
 * Field descriptors modeled on live Greenhouse application forms (job-boards.greenhouse.io,
 * late 2026): ids, labels, kinds and option texts as the page script reports them.
 * Applicant data here is fictional.
 */
import { EMPTY_PROFILE, type Profile } from '@shared/profile'
import type { FieldDescriptor } from './fields'

let n = 0
export function field(p: Partial<FieldDescriptor> & Pick<FieldDescriptor, 'label'>): FieldDescriptor {
  return { key: `k${++n}`, name: '', id: '', kind: 'text', autocomplete: '', options: [], required: false, multi: false, hasValue: false, group: '', ...p }
}

const DEGREES = [
  "Associate's Degree",
  "Bachelor's Degree",
  'Doctor of Medicine (M.D.)',
  'Doctor of Philosophy (Ph.D.)',
  "Engineer's Degree",
  'High School',
  'Juris Doctor (J.D.)',
  'Master of Business Administration (M.B.A.)',
  "Master's Degree",
  'Other',
]
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const YES_NO = ['Yes', 'No']

/** A typical new-style form: standard fields, education, custom questions and the US EEO block. */
export const greenhouseForm = (): FieldDescriptor[] => [
  field({ id: 'first_name', label: 'First Name', autocomplete: 'given-name', required: true }),
  field({ id: 'last_name', label: 'Last Name', autocomplete: 'family-name', required: true }),
  field({ id: 'preferred_name', label: 'Preferred First Name' }),
  field({ id: 'email', label: 'Email', autocomplete: 'email', required: true }),
  field({ id: 'country', label: 'Country', kind: 'combobox', group: 'Phone', required: true, options: ['United States +1', 'United States Minor Outlying Islands +1', 'Canada +1', 'Afghanistan +93'] }),
  field({ id: 'phone', label: 'Phone', kind: 'tel', required: true }),
  field({ id: 'candidate-location', label: 'Location (City)', kind: 'combobox', required: true }),
  field({ id: 'resume', label: 'Resume/CV', kind: 'file', required: true }),
  field({ id: 'cover_letter', label: 'Cover Letter', kind: 'file' }),
  field({ id: 'school--0', label: 'School', kind: 'combobox', required: true, options: ['Aalborg University', 'Aalto University', 'Aarhus University'] }),
  field({ id: 'degree--0', label: 'Degree', kind: 'combobox', required: true, options: DEGREES }),
  field({ id: 'discipline--0', label: 'Discipline', kind: 'combobox', options: ['Computer Science', 'Electrical Engineering', 'Electrical Engineering and Computer Science', 'Mathematics'] }),
  field({ id: 'start-month--0', label: 'Start date month', kind: 'combobox', options: MONTHS }),
  field({ id: 'start-year--0', label: 'Start date year', kind: 'number' }),
  field({ id: 'end-month--0', label: 'End date month', kind: 'combobox', required: true, options: MONTHS }),
  field({ id: 'end-year--0', label: 'End date year', kind: 'number', required: true }),
  field({ id: 'question_13195393007', label: 'LinkedIn Profile', required: true }),
  field({ id: 'question_24387192002', label: 'Website' }),
  field({ id: 'question_9000000001', label: 'GitHub URL' }),
  field({
    id: 'question_13253105007',
    label: 'What is your expected graduation month & year?',
    kind: 'combobox',
    required: true,
    options: ['Already graduated', 'Jan - April 2027', 'May - Aug 2027', 'Sept - Dec 2027', 'Jan - April 2028', 'May - Aug 2028', 'Sept - Dec 2028', 'Jan 2029 or later'],
  }),
  field({ id: 'question_24387193002', label: 'How did you hear about this job?' }),
  field({ id: 'question_19018743008', label: 'Why Cobaltine AI?', kind: 'textarea', required: true }),
  field({
    id: 'question_13195395007',
    label: 'Are you legally authorized to work in the country where the job is located?',
    kind: 'combobox',
    required: true,
    options: [
      'Yes, I am currently legally authorized to work in the country where the jobs is located.',
      'No, I am not currently legally authorized to work in the country where the job is located.',
    ],
  }),
  field({
    id: 'question_13195396007',
    label: 'Will you now or in the future require company sponsorship to retain or extend your employment visa status?',
    kind: 'combobox',
    required: true,
    options: YES_NO,
  }),
  field({ id: 'question_19018752008', label: 'Agreement to Arbitrate', kind: 'combobox', required: true, options: ['I agree'] }),
  field({ id: '4012865007', label: 'How would you describe your gender identity? (mark all that apply)', kind: 'combobox', multi: true, options: ['Man', 'Non-binary', 'Woman', 'I prefer to self-describe', "I don't wish to answer"] }),
  field({ id: '4012868007', label: 'Do you identify as transgender? (select one)', kind: 'combobox', options: ['Yes', 'No', "I don't wish to answer"] }),
  field({ id: 'gender', label: 'Gender', kind: 'combobox', options: ['Male', 'Female', 'Decline To Self Identify'] }),
  field({ id: 'hispanic_ethnicity', label: 'Are you Hispanic/Latino?', kind: 'combobox', options: ['Yes', 'No', 'Decline To Self Identify'] }),
  field({
    id: 'race',
    label: 'Please identify your race',
    kind: 'combobox',
    options: [
      'American Indian or Alaskan Native',
      'Asian',
      'Black or African American',
      'Hispanic or Latino',
      'White',
      'Native Hawaiian or Other Pacific Islander',
      'Two or More Races',
      'Decline To Self Identify',
    ],
  }),
  field({
    id: 'veteran_status',
    label: 'Veteran Status',
    kind: 'combobox',
    options: ['I am not a protected veteran', 'I identify as one or more of the classifications of a protected veteran', "I don't wish to answer"],
  }),
  field({
    id: 'disability_status',
    label: 'Disability Status',
    kind: 'combobox',
    options: [
      'Yes, I have a disability, or have had one in the past',
      'No, I do not have a disability and have not had one in the past',
      'I do not want to answer',
    ],
  }),
]

/** A clearly fake applicant. */
export const testProfile = (over: Partial<Profile> = {}): Profile => ({
  ...EMPTY_PROFILE,
  legalFirstName: 'Test',
  legalLastName: 'User',
  preferredName: 'Tess',
  email: 'test@example.com',
  phone: '+1 555 010 0100',
  city: 'Berkeley',
  region: 'CA',
  country: 'United States',
  linkedin: 'https://linkedin.com/in/test-user-example',
  github: 'https://github.com/test-user-example',
  website: 'https://test-user.example.com',
  education: [{ school: 'Example State University', degree: 'B.S.', field: 'Electrical Engineering and Computer Science', startDate: '2024-08', endDate: '2027-05', gpa: '3.7/4.0' }],
  authorizedToWorkUS: true,
  needsSponsorship: false,
  answers: [{ id: 'a1', question: 'How did you hear about us?', answer: 'Company careers page' }],
  ...over,
})
