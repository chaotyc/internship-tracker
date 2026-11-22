import type { Feature } from '../context'
import { rolesFeature } from './roles'
import { profileFeature } from './profile'
import { aiFeature } from './ai'
import { searchFeature } from './search'
import { chatFeature } from './chat'
import { autofillFeature } from './autofill'
import { todayFeature } from './today'

/** Registration order matters: later features use services set by earlier ones. */
export const features: Feature[] = [rolesFeature, profileFeature, aiFeature, searchFeature, chatFeature, autofillFeature, todayFeature]
