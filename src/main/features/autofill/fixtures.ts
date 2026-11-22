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

const YEARS = Array.from({ length: 30 }, (_, i) => String(2031 - i))

/**
 * An Ashby form (jobs.ashbyhq.com, late 2026) as the Ashby dialect reports it, combining
 * fields seen on intern postings: system fields, a Phone field, the location autocomplete,
 * radio and checkbox groups, Yes/No buttons (reported as radios), a react-datepicker date,
 * the education-history block (ids rewritten to "school--0" and so on) and the EEO survey.
 */
export const ashbyForm = (): FieldDescriptor[] => [
  field({ id: '_systemfield_name', name: '_systemfield_name', label: 'Name', required: true }),
  field({ id: '4954bb12-cfea-443f-b979-72832ac8cd26', name: '4954bb12-cfea-443f-b979-72832ac8cd26', label: 'Preferred Name', required: true }),
  field({ id: 'b1c2d3e4-0000-4000-8000-00000000a001', name: 'b1c2d3e4-0000-4000-8000-00000000a001', label: 'Name in native language (if applicable)' }),
  field({ id: '_systemfield_email', name: '_systemfield_email', label: 'Email', kind: 'email', required: true }),
  field({ id: '74855088-f9c6-4147-8f82-847c46552c6c', name: '74855088-f9c6-4147-8f82-847c46552c6c', label: 'Phone Number', kind: 'tel', required: true }),
  field({ id: '_systemfield_resume', label: 'Resume', kind: 'file', required: true }),
  field({ id: '', label: 'Current Location', kind: 'combobox', required: true }),
  field({ id: '1d70fc29-ef16-440f-ba91-396211138a10', name: '1d70fc29-ef16-440f-ba91-396211138a10', label: 'LinkedIn Profile URL' }),
  field({ id: '0f95c2bf-b604-4cdf-a38b-6173ceb1e6b3', name: '0f95c2bf-b604-4cdf-a38b-6173ceb1e6b3', label: 'GitHub or Portfolio URL' }),
  field({ id: 'bd44eaa2-fa61-43c3-9989-f6c5a0d31610', label: 'Which term(s) would you like to be considered for?', kind: 'checkboxes', multi: true, required: true, options: ['Winter (January - May)', 'Summer (May - August)'] }),
  field({
    id: 'd88b071e-476e-4d35-bf2d-1d54829abc27',
    label: 'Are you legally authorized to work in the United States?',
    kind: 'radio',
    required: true,
    options: [
      'YES: If you currently hold a valid work permit (such as OPT, CPT, or an existing H-1B transfer).',
      'NO: If you do not have any active, legal authorization to work in the country right now.',
    ],
  }),
  field({ id: '8ca88f6a-ff11-4628-b365-b7d7762aa997', label: 'Will you now or in the future require employer sponsorship for employment visa status (e.g., H-1B)?', kind: 'radio', required: true, options: ['YES', 'NO'] }),
  field({ id: '8c5fe320-bbac-4094-b92f-c67fe0636176', label: 'Will you now or at any time in the future require sponsorship for employment visa status (e.g. H1B, OPT)?', kind: 'radio', required: true, options: ['OPT', 'H1B', 'TN', 'None', 'Other'] }),
  field({ id: '5b1eca92-4129-4380-b685-70e9857a906c', label: 'Will you now or in the future require sponsorship for employment visa status in the United Kingdom, Germany or Serbia?', kind: 'radio', required: true, options: YES_NO }),
  field({ id: 'f86ea170-ae22-4fdd-b53f-eaa42f13fbb3', label: 'Are you authorized to work lawfully in the United States?', kind: 'radio', required: true, options: YES_NO }),
  field({ id: '7e8a1a3e-0693-4204-806e-73e8d186fbd2', name: '7e8a1a3e-0693-4204-806e-73e8d186fbd2', label: 'College or University', required: true }),
  field({ id: '1eb79e18-4220-417c-be6b-23650e4bca9f', name: '1eb79e18-4220-417c-be6b-23650e4bca9f', label: 'Major or Field of Study', required: true }),
  field({ id: '8af4f7b4-0675-4a2c-97a8-612d02b754e9', label: 'Current Program Type', kind: 'radio', required: true, options: ['PhD', "Master's Degree", 'JD', 'MBA', "Bachelor's Degree", 'High School', 'Other'] }),
  field({ id: '', label: 'Expected Graduation Date', kind: 'date', required: true }),
  field({ id: '', label: 'When can you start a new role?', kind: 'date', required: true }),
  field({ id: 'bee2fbd1-5dfe-430b-96a3-8699f38b73e5', name: 'bee2fbd1-5dfe-430b-96a3-8699f38b73e5', label: 'Current GPA' }),
  field({ id: 'a41a6068-b2e3-45dd-8d62-3762dbf2c21b', label: 'Are you able to work in-person in San Jose this summer?', kind: 'radio', required: true, options: YES_NO }),
  field({ id: 'f9ade9cf-e29f-4277-94e6-3e9d8ca5fd86', name: 'f9ade9cf-e29f-4277-94e6-3e9d8ca5fd86', label: 'Why do you want to join Vectorline?', kind: 'textarea', required: true }),
  field({ id: '23ff2add-a123-4e2a-b071-00da8f33300e', name: '23ff2add-a123-4e2a-b071-00da8f33300e', label: 'SAT or ACT Score', required: true }),
  field({ id: '601224f8-785f-4bc7-b41b-023ec4d2f7bb', label: 'How did you hear about Vectorline?', kind: 'radio', options: ['LinkedIn', 'Company Website', 'Through a Friend', 'Referral', 'Twitter/X', 'Other'] }),
  // Education history block (Ramp-style), rewritten by the dialect.
  field({ id: 'school--0', label: 'School', kind: 'combobox', required: true }),
  field({ id: 'degree--0', label: 'Degree' }),
  field({ id: 'discipline--0', label: 'Field of Study' }),
  field({ id: 'start-month--0', label: 'Start date month', kind: 'select', options: MONTHS }),
  field({ id: 'start-year--0', label: 'Start date year', kind: 'select', options: YEARS }),
  field({ id: 'end-month--0', label: 'End date month', kind: 'select', options: MONTHS }),
  field({ id: 'end-year--0', label: 'End date year', kind: 'select', options: YEARS }),
  // EEO survey
  field({ id: '_systemfield_eeoc_gender', label: 'Gender', kind: 'radio', options: ['Male', 'Female', 'Decline to self-identify'] }),
  field({
    id: '_systemfield_eeoc_race',
    label: 'Race',
    kind: 'radio',
    options: [
      'Hispanic or Latino',
      'White (Not Hispanic or Latino)',
      'Black or African American (Not Hispanic or Latino)',
      'Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)',
      'Asian (Not Hispanic or Latino)',
      'American Indian or Alaska Native (Not Hispanic or Latino)',
      'Two or More Races (Not Hispanic or Latino)',
      'Decline to self-identify',
    ],
  }),
  field({
    id: '_systemfield_eeoc_veteran_status',
    label: 'Veteran Status',
    kind: 'radio',
    options: ['I identify as one or more of the classifications of protected veteran listed above', 'I am not a protected veteran', 'I decline to self-identify for protected veteran status'],
  }),
]

const CARD = 'cards[052d2626-bf56-45c0-8877-e76519fe4879]'
const SOURCE = 'cards[e8ce49f5-0ede-48f5-86be-5738aa5552c2]'

/**
 * A Lever form (jobs.lever.co, late 2026) as the Lever dialect reports it: the standard
 * fields, the location autocomplete (reported as a combobox), links, custom question
 * cards and the US EEO selects with the disability form's signature fields.
 */
export const leverForm = (): FieldDescriptor[] => [
  field({ id: 'resume-upload-input', name: 'resume', label: 'Resume/CV', kind: 'file', required: true }),
  field({ name: 'name', label: 'Full name', required: true }),
  field({ name: 'email', label: 'Email', kind: 'email', required: true }),
  field({ name: 'phone', label: 'Phone', required: true }),
  field({ id: 'location-input', name: 'location', label: 'Current location', kind: 'combobox' }),
  field({ name: 'org', label: 'Current company', required: true }),
  field({ name: 'urls[LinkedIn]', label: 'LinkedIn URL' }),
  field({ name: 'urls[GitHub]', label: 'GitHub URL' }),
  field({ name: 'urls[Portfolio]', label: 'Portfolio URL' }),
  field({ name: 'urls[Other]', label: 'Other website' }),
  field({ name: `${CARD}[field0]`, label: 'Describe how you’ve used Infrastructure-as-Code to make a deployment repeatable across more than one environment or site.', kind: 'textarea', required: true }),
  field({
    name: `${CARD}[field1]`,
    label: 'Have you directly operated and maintained a sub-Kelvin cryogenic system (e.g. dilution refrigerators)?',
    kind: 'radio',
    required: true,
    options: ['Yes – primary owner/operator', 'Yes – supported but not primary owner', 'Indirect exposure only', 'No Experience'],
  }),
  field({ name: `${CARD}[field2]`, label: 'Which of the following have you personally performed?', kind: 'checkboxes', multi: true, required: true, options: ['Helium leak detection', 'Vacuum pump rebuilds', 'Cryo compressor servicing'] }),
  field({ name: `${CARD}[field3]`, label: 'Are you legally authorized to work in the United States?', kind: 'radio', required: true, options: YES_NO }),
  field({ name: `${CARD}[field4]`, label: 'How did you hear about Quanta?', kind: 'textarea', required: true }),
  field({ name: `${SOURCE}[field2]`, label: 'If "Referral", please articulate who. If you were not referred, input "N/A"', required: true }),
  field({ name: 'eeo[gender]', label: 'Gender', kind: 'select', options: ['Male', 'Female', 'Decline to self-identify'] }),
  field({
    name: 'eeo[race]',
    label: 'Race',
    kind: 'select',
    options: [
      'Hispanic or Latino',
      'White (Not Hispanic or Latino)',
      'Black or African American (Not Hispanic or Latino)',
      'Asian (Not Hispanic or Latino)',
      'Two or More Races (Not Hispanic or Latino)',
      'Decline to self-identify',
    ],
  }),
  field({
    name: 'eeo[veteran]',
    label: 'Veteran status',
    kind: 'select',
    options: ['I identify as one or more of the classifications of protected veteran listed above', 'I am not a protected veteran', 'I decline to self-identify for protected veteran status'],
  }),
  field({
    id: 'disabilitySelectElement',
    name: 'eeo[disability]',
    label: 'Disability status',
    kind: 'select',
    options: ['Yes, I have a disability, or have had one in the past', 'No, I do not have a disability and have not had one in the past', 'I do not want to answer'],
  }),
  field({ name: 'eeo[disabilitySignature]', label: 'Name' }),
  field({ name: 'eeo[disabilitySignatureDate]', label: 'Date' }),
]
