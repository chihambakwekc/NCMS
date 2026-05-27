import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  Eye,
  File,
  FileSearch,
  FileText,
  FolderCheck,
  History,
  Inbox,
  Info as InfoIcon,
  LayoutDashboard,
  Lock,
  LogIn,
  MapPin,
  Maximize2,
  Monitor,
  MessageSquareMore,
  Menu,
  PencilLine,
  Plus,
  Search,
  Settings,
  Send,
  Shield,
  ShieldAlert,
  Trash2,
  UserCheck,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react"
import ReactECharts from "echarts-for-react"
import type { ElementType, ReactNode } from "react"
import { useEffect, useRef, useState } from "react"
import type { LatLngBoundsExpression } from "leaflet"
import { CircleMarker, LayerGroup, LayersControl, MapContainer, Popup, TileLayer, useMap } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import { apiChangePassword, apiDelete, apiGet, apiLogin, apiLogout, apiPatch, apiPost, currentUser } from "./services/api"
import type { PasswordChangeRequired } from "./services/api"
import { pendingSyncCount } from "./services/offlineDb"
import { registerSyncTriggers } from "./services/syncQueue"
import coatOfArms from "./assets/cot.svg"

type Portal = "external" | "admin"
type AlertStatus =
  | "Submitted"
  | "Received by District Office"
  | "Under Review"
  | "More Information Requested"
  | "Converted to Case"
  | "Referred to Relevant Office"
  | "Closed - No Further Action"
  | "Duplicate / Already Known"
  | "Emergency Response Initiated"
  | "Ready for Intake"
  | "Intake In Progress"
  | "Pending Supervisor Review"
  | "Approved for Allocation"
  | "Allocated to Case Officer"
  | "Closed - Invalid"
  | "Referred Externally"
  | "Merged Duplicate"
  | "Emergency Escalated"
  | "Rejected"

type AlertRecord = {
  id: string
  childName: string
  child_first_name?: string
  child_surname?: string
  child_alias?: string
  sex: string
  age: string
  date_of_birth?: string
  birth_certificate_number?: string
  birth_registered?: string
  disability?: string
  current_location?: string
  home_address?: string
  district: string
  ward: string
  village_suburb?: string
  nearest_landmark?: string
  caregiver_name?: string
  caregiver_contact?: string
  relationship_to_child?: string
  protect_reporter_identity?: boolean
  reporter: string
  reporterType: string
  concern: string
  concern_categories?: string[]
  danger: string[]
  danger_screening?: Record<string, string>
  description: string
  intake_source?: string
  reporting_channel?: string
  information_source_type?: string
  information_source_other?: string
  information_source_name?: string
  information_source_surname?: string
  information_source_first_names?: string
  information_source_id_number?: string
  information_source_sex?: string
  information_source_contact?: string
  information_source_email?: string
  information_source_address?: string
  information_source_relationship_to_child?: string
  information_source_reporter_type?: string
  protect_source_identity?: boolean
  alternative_contact?: string
  source_brief_description?: string
  incident_date?: string
  date_reporter_became_aware?: string
  incident_location?: string
  alleged_perpetrator_name?: string
  alleged_perpetrator_relationship?: string
  perpetrator_has_access?: string
  immediate_action_taken?: string
  services_contacted?: string
  attachments?: Array<{ name: string; type?: string; url?: string }>
  status: AlertStatus
  internalStatus: string
  emergency: boolean
  intakeOfficer: string
  caseCategory: string
  riskLevel: string
  actionPlan: string
  allocatedOfficer: string
  submittedAt: string
}

function splitAlertConcern(concern: string) {
  return concern.split(",").map((item) => item.trim()).filter(Boolean)
}

function alertConcerns(alert: AlertRecord) {
  return alert.concern_categories?.length ? alert.concern_categories : splitAlertConcern(alert.concern)
}

function sourceTypeLabel(alert: AlertRecord) {
  if (alert.information_source_type === "Other" && alert.information_source_other) return `Other: ${alert.information_source_other}`
  return alert.information_source_type || "Not captured"
}

function submittedByLabel(alert: AlertRecord) {
  return [alert.reporter, alert.reporterType].filter(Boolean).join(", ") || "Not captured"
}

type CaseRecord = {
  id: string
  backendIntakeId?: number
  sourceAlertId?: string
  intakeDraft?: IntakeRecord
  childName: string
  sex: string
  age: string
  district: string
  ward: string
  concern: string
  riskLevel: string
  status: "Draft" | "Submitted" | "Pending Supervisor Review" | "Approved for Allocation" | "Allocated"
  intakeOfficer: string
  allocatedOfficer?: string
  allocatedAt?: string
  screeningCompletedAt?: string
  allocationDelaySeconds?: number | null
  allocationDelayStatus?: string
  assessmentStartedAt?: string | null
  assessmentDueAt?: string | null
  assessmentCompletedAt?: string | null
  assessmentRemainingSeconds?: number | null
  assessmentSlaStatus?: string
  assessmentCarePlanStatus?: string
  caseReviewDueAt?: string | null
  caseReviewStatus?: string
  closureStatus?: string
  createdAt: string
  submittedForReviewAt?: string
  description: string
  background_information?: Record<string, string>
  prior_assistance?: PriorAssistanceDraft[]
  manualMinimumComplete?: boolean
}

type SaveDraftCaseOptions = {
  openIntake?: boolean
}

type PriorAssistanceDraft = {
  information_known: string
  source_type: "" | "PARTNER" | "DISTRICT"
  partner_id: string
  partner_name: string
  district_id: string
  district_name: string
  other_district: string
  services: string[]
  other_service: string
  service_date: string
  status: string
  outcome: string
  notes: string
}

type IntakeRecord = {
  id: number
  alert: number | null
  alertReference?: string | null
  temporary_case_reference: string
  intake_source?: string
  original_alert_snapshot?: Record<string, unknown>
  opening_summary?: Record<string, unknown>
  child_profile_draft?: Record<string, unknown>
  household_profile_draft?: Record<string, unknown>
  background_information?: Record<string, string>
  prior_assistance?: PriorAssistanceDraft[]
  initial_screening_notes?: string
  screening_completed_at?: string | null
  case_category?: string
  risk_level?: string
  immediate_action_required?: boolean
  immediate_action_plan?: string
  supervisor_notes?: string
  reviewedByName?: string
  reviewed_at?: string | null
  allocatedByName?: string
  allocated_at?: string | null
  allocationDelaySeconds?: number | null
  allocationDelayStatus?: string
  assessment_draft?: Record<string, unknown>
  care_plan_draft?: Record<string, unknown>
  referrals_draft?: Record<string, unknown>[] | Record<string, unknown>
  service_tracking_draft?: Record<string, unknown>[] | Record<string, unknown>
  case_notes_draft?: Record<string, unknown>[] | Record<string, unknown>
  case_documents_draft?: Record<string, unknown>[] | Record<string, unknown>
  assessment_started_at?: string | null
  assessment_due_at?: string | null
  assessment_completed_at?: string | null
  assessmentCompletedByName?: string
  assessmentRemainingSeconds?: number | null
  assessmentSlaStatus?: string
  assessment_care_plan_status?: string
  case_review_due_at?: string | null
  caseReviewStatus?: string
  closure_status?: string
  status: string
  allocatedOfficerName?: string
  created_at: string
}

type IntakeUpdateField = {
  path: string
  label: string
  current_value: string
  proposed_value?: string
}

type IntakeUpdateTab = {
  key: string
  label: string
  fields: IntakeUpdateField[]
}

type IntakeUpdateRequest = {
  id: number
  intake: number
  caseReference: string
  tab: string
  requested_fields: IntakeUpdateField[]
  reason: string
  status: "Pending" | "Approved" | "Rejected"
  requestedByName: string
  requested_at: string
  reviewedByName: string
  reviewed_at: string | null
  review_notes: string
}

function caseStatusFromIntake(status: string): CaseRecord["status"] {
  if (status === "Pending Supervisor Review") return "Pending Supervisor Review"
  if (status === "Approved for Allocation") return "Approved for Allocation"
  if (status === "Allocated to Case Officer") return "Allocated"
  if (status === "Intake Submitted") return "Submitted"
  return "Draft"
}

function districtCodeFromName(districtName: string, districts: DistrictOption[]) {
  return districts.find((district) => district.name === districtName)?.code?.toUpperCase() || ""
}

function caseSequenceParts(reference: string) {
  const parts = reference.split("-").filter(Boolean)
  const year = parts.find((part) => /^\d{4}$/.test(part)) || new Date().getFullYear().toString()
  const sequence = [...parts].reverse().find((part) => /^\d+$/.test(part) && part !== year) || "001"
  return { year, sequence: sequence.padStart(3, "0") }
}

function formatCaseNumber(reference: string, districtCode = "") {
  const { year, sequence } = caseSequenceParts(reference)
  return `CASE-${districtCode || "PENDING"}-${year}-${sequence}`
}

function displayCaseId(intake: IntakeRecord, districts: DistrictOption[] = []) {
  if (intake.alertReference) {
    const parts = intake.alertReference.split("-")
    return formatCaseNumber(intake.alertReference, parts.length >= 4 ? parts[2] : "")
  }
  const childDraft = intake.child_profile_draft || {}
  const snapshot = intake.original_alert_snapshot || {}
  const opening = intake.opening_summary || {}
  const districtName = textValue(childDraft.district) || textValue(snapshot.district) || nestedTextValue(opening, "district")
  return formatCaseNumber(intake.temporary_case_reference, districtCodeFromName(districtName, districts))
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

function arrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => textValue(item)).filter(Boolean) : []
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function nestedTextValue(source: Record<string, unknown>, key: string) {
  const value = source[key]
  return typeof value === "object" && value !== null ? "" : textValue(value)
}

function hasText(value: unknown) {
  return textValue(value).trim().length > 0
}

function hasManualSummaryData(opening: Record<string, unknown>) {
  return hasText(opening.intake_source) && hasText(opening.district) && hasText(opening.ward)
}

function hasManualOfficerInformantData(opening: Record<string, unknown>) {
  const informant = typeof opening.informant === "object" && opening.informant !== null ? opening.informant as Record<string, unknown> : {}
  return [
    informant.surname,
    informant.first_names,
    informant.phone,
    informant.relationship_to_child,
    informant.organization,
    informant.reporter_type,
  ].some(hasText)
}

function hasManualChildData(childDraft: Record<string, unknown>) {
  const childKnown = textValue(childDraft.known)
  if (!childKnown) return false
  if (childKnown === "No") return hasText(childDraft.age) || hasText(childDraft.current_location)
  return [childDraft.first_names, childDraft.surname, childDraft.age, childDraft.current_location].some(hasText)
}

function hasManualMinimumIntakeData(opening: Record<string, unknown>, childDraft: Record<string, unknown>) {
  return hasManualSummaryData(opening) && hasManualOfficerInformantData(opening) && hasManualChildData(childDraft)
}

function dateInputValue(value: string) {
  const parsed = parseWorkflowDate(value)
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10)
}

function officerDefaults(user: ApiUser) {
  return {
    officer_user_id: `${user.id}`,
    officer_surname: user.last_name || "",
    officer_first_names: user.first_name || user.username || "",
    officer_designation: user.profile.roleLabel || user.profile.role || "",
    officer_district: user.profile.districtName || "",
    officer_contact: user.profile.phone || user.email || "",
  }
}

function caseFromIntake(intake: IntakeRecord, alerts: AlertRecord[], districts: DistrictOption[] = []): CaseRecord {
  const sourceAlert = intake.alertReference ? alerts.find((item) => item.id === intake.alertReference) : undefined
  const childDraft = intake.child_profile_draft || {}
  const snapshot = intake.original_alert_snapshot || {}
  const opening = intake.opening_summary || {}
  const screeningDraft = objectValue(opening.screening_draft)
  const intakeOfficer = [nestedTextValue(opening, "officer_first_names"), nestedTextValue(opening, "officer_surname")].filter(Boolean).join(" ")
  const childName = [textValue(childDraft.first_names), textValue(childDraft.surname)].filter(Boolean).join(" ")
  return {
    id: displayCaseId(intake, districts),
    backendIntakeId: intake.id,
    sourceAlertId: intake.alertReference || undefined,
    intakeDraft: intake,
    childName: sourceAlert?.childName || childName || textValue(childDraft.name) || textValue(snapshot.child_name) || "Unknown child",
    sex: sourceAlert?.sex || textValue(childDraft.sex) || textValue(snapshot.sex) || "Unknown",
    age: sourceAlert?.age || textValue(childDraft.age) || textValue(snapshot.age) || "Unknown",
    district: sourceAlert?.district || textValue(opening.district) || textValue(childDraft.district) || textValue(snapshot.district),
    ward: sourceAlert?.ward || textValue(opening.ward) || textValue(childDraft.ward) || textValue(snapshot.ward),
    concern: intake.case_category || sourceAlert?.concern || textValue(opening.concern_summary) || "Uncategorized",
    riskLevel: intake.risk_level || sourceAlert?.riskLevel || "Pending",
    status: caseStatusFromIntake(intake.status),
    intakeOfficer: sourceAlert?.intakeOfficer || intakeOfficer || "Intake Officer",
    allocatedOfficer: intake.allocatedOfficerName || undefined,
    allocatedAt: textValue(intake.allocated_at),
    screeningCompletedAt: textValue(intake.screening_completed_at),
    allocationDelaySeconds: intake.allocationDelaySeconds,
    allocationDelayStatus: intake.allocationDelayStatus,
    assessmentStartedAt: intake.assessment_started_at || null,
    assessmentDueAt: intake.assessment_due_at || null,
    assessmentCompletedAt: intake.assessment_completed_at || null,
    assessmentRemainingSeconds: intake.assessmentRemainingSeconds,
    assessmentSlaStatus: intake.assessmentSlaStatus,
    assessmentCarePlanStatus: intake.assessment_care_plan_status,
    caseReviewDueAt: intake.case_review_due_at || null,
    caseReviewStatus: intake.caseReviewStatus,
    closureStatus: intake.closure_status,
    createdAt: intake.created_at,
    submittedForReviewAt: textValue(intake.screening_completed_at) || textValue(screeningDraft.submitted_for_review_at),
    description: intake.immediate_action_plan || sourceAlert?.description || textValue(opening.reporter_narrative) || textValue(snapshot.description),
    background_information: intake.background_information || {},
    prior_assistance: intake.prior_assistance || [],
    manualMinimumComplete: Boolean(intake.alertReference) || hasManualMinimumIntakeData(opening, childDraft),
  }
}

type Metric = {
  label: string
  value: string | number
  icon: ElementType
  tone: string
}

type DistrictOption = {
  id: number
  name: string
  code: string
  province: number
  provinceName: string
}

type WardOption = {
  id: number
  name: string
  district: number
  districtName: string
}

type ProvinceOption = {
  id: number
  name: string
}

type ApiUser = {
  id: number
  username: string
  first_name: string
  last_name: string
  email: string
  profile: {
    role: string
    roleLabel: string
    portal: "external" | "internal"
    phone: string
    organization: number | null
    organizationName: string
    province: number | null
    provinceName: string
    district: number | null
    districtName: string
    ward: number | null
    wardName: string
    active: boolean
    must_change_password: boolean
  }
}

type OrganizationOption = {
  id: number
  name: string
  organization_type: string
  district: number | null
}

type CalendarTask = {
  id: string | number
  title: string
  detail: string
  date: string
  urgent: boolean
  source: string
}

function isPasswordChangeRequired(value: unknown): value is PasswordChangeRequired {
  return Boolean(value && typeof value === "object" && "passwordChangeRequired" in value)
}

const concernCategories = [
  "Sexual abuse",
  "Physical abuse",
  "Emotional abuse",
  "Neglect",
  "Child abandonment",
  "Child marriage",
  "Child trafficking",
  "Child living/working on streets",
  "Needs birth certificate",
  "Food insecurity",
  "Medical support needed",
  "Court order involved",
  "Police involved",
  "Foster care/adoption/placement concern",
]

const dangerQuestions = [
  "Child currently in danger",
  "Child injured",
  "Child with alleged perpetrator now",
  "Urgent medical attention needed",
  "Child abandoned or without adult care",
  "Child sleeping outside/on the street",
  "Missing or trafficked",
  "Sexual abuse alleged",
  "Police already involved",
  "Place of safety needed",
  "Risk within next 24 hours",
]

const emptyAlert: AlertRecord = {
  id: "",
  childName: "",
  sex: "",
  age: "",
  district: "",
  ward: "",
  reporter: "",
  reporterType: "",
  concern: "",
  danger: [],
  description: "",
  status: "Submitted",
  internalStatus: "",
  emergency: false,
  intakeOfficer: "",
  caseCategory: "",
  riskLevel: "",
  actionPlan: "",
  allocatedOfficer: "",
  submittedAt: "",
}

type ZimRegion = {
  name: string
  districts: string[]
  priority: "Low" | "Medium" | "High"
  positions: [number, number][]
}

const zimbabweRegions: ZimRegion[] = [
  { name: "Harare Metropolitan", districts: ["Harare"], priority: "High", positions: [[-17.55, 30.75], [-17.55, 31.35], [-18.05, 31.45], [-18.2, 30.95], [-17.9, 30.62]] },
  { name: "Masvingo Province", districts: ["Masvingo", "Chiredzi"], priority: "High", positions: [[-19.5, 29.7], [-19.25, 32.2], [-21.9, 32.0], [-22.15, 30.1], [-20.95, 29.1]] },
  { name: "Midlands Province", districts: ["Gweru", "Kwekwe"], priority: "Medium", positions: [[-18.0, 28.0], [-17.6, 30.4], [-19.5, 29.7], [-20.3, 28.0], [-19.0, 27.2]] },
  { name: "Matabeleland North", districts: ["Hwange", "Binga"], priority: "Low", positions: [[-17.0, 25.2], [-17.1, 28.0], [-19.0, 27.2], [-20.2, 25.6], [-18.7, 24.8]] },
  { name: "Manicaland Province", districts: ["Mutare", "Chipinge"], priority: "Medium", positions: [[-17.65, 32.0], [-18.3, 33.1], [-21.1, 32.9], [-21.9, 32.0], [-19.25, 32.2]] },
  { name: "Bulawayo Metropolitan", districts: ["Bulawayo"], priority: "Medium", positions: [[-20.0, 28.35], [-20.0, 28.8], [-20.45, 28.85], [-20.55, 28.35]] },
]

const inputClass =
  "h-11 w-full rounded-md border border-[#d8dee8] bg-white px-3 text-sm text-[#23364f] outline-none transition focus:border-[#008c7a] focus:ring-4 focus:ring-[#008c7a]/15"

function isAdminPortalHost() {
  return window.location.hostname === "childprotection.co.zw"
}

function initialPortal(): Portal {
  return window.location.pathname.startsWith("/login") || isAdminPortalHost() ? "admin" : "external"
}

export function App() {
  const [alerts, setAlerts] = useState<AlertRecord[]>([])
  const [portal, setPortal] = useState<Portal>(initialPortal)
  const [user, setUser] = useState<ApiUser | null>(currentUser())
  const [districts, setDistricts] = useState<DistrictOption[]>([])
  const [provinces, setProvinces] = useState<ProvinceOption[]>([])
  const [wards, setWards] = useState<WardOption[]>([])
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([])
  const [users, setUsers] = useState<ApiUser[]>([])
  const [apiError, setApiError] = useState("")
  const [externalView, setExternalView] = useState("dashboard")
  const [adminView, setAdminView] = useState("dashboard")
  const [selectedAlertId, setSelectedAlertId] = useState("")
  const [cases, setCases] = useState<CaseRecord[]>([])
  const [calendarTasks, setCalendarTasks] = useState<CalendarTask[]>([])
  const [selectedCaseId, setSelectedCaseId] = useState("")
  const [openIntakeCaseId, setOpenIntakeCaseId] = useState("")
  const [internalSidebarCollapsed, setInternalSidebarCollapsed] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [pendingSync, setPendingSync] = useState(0)

  const selectedAlert = alerts.find((alert) => alert.id === selectedAlertId) ?? alerts[0] ?? emptyAlert
  const selectedCase = cases.find((caseRecord) => caseRecord.id === selectedCaseId) ?? cases[0]

  useEffect(() => {
    if (isAdminPortalHost() && !window.location.pathname.startsWith("/login")) {
      window.history.replaceState(null, "", "/login")
    }
  }, [])

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine)
    const updatePending = () => pendingSyncCount().then(setPendingSync).catch(() => undefined)
    window.addEventListener("online", updateOnline)
    window.addEventListener("offline", updateOnline)
    const stopSync = registerSyncTriggers(setPendingSync)
    const timer = window.setInterval(updatePending, 5000)
    updatePending()
    return () => {
      window.removeEventListener("online", updateOnline)
      window.removeEventListener("offline", updateOnline)
      window.clearInterval(timer)
      stopSync()
    }
  }, [])

  useEffect(() => {
    if (!user) return
    const currentUserAccount = user
    async function loadReferenceData() {
      try {
        const [provinceData, districtData, wardData, organizationData] = await Promise.all([apiGet<ProvinceOption[]>("/provinces/"), apiGet<DistrictOption[]>("/districts/"), apiGet<WardOption[]>("/wards/"), apiGet<OrganizationOption[]>("/organizations/")])
        setProvinces(provinceData)
        setDistricts(districtData)
        setWards(wardData)
        setOrganizations(organizationData)
        if (currentUserAccount.profile.portal === "internal") await refreshIntakes(alerts, districtData)
      } catch {
        setProvinces([])
        setDistricts([])
        setWards([])
        setOrganizations([])
      }
    }
    loadReferenceData()
  }, [user])

  useEffect(() => {
    if (!user) return
    async function loadOperationalData() {
      const loadedAlerts = await refreshAlerts()
      if (user?.profile.portal === "internal") await refreshIntakes(loadedAlerts)
    }
    loadOperationalData()
    if (user.profile.portal === "internal") {
      refreshUsers()
      refreshCalendarTasks()
    }
  }, [user])

  async function refreshAlerts() {
    try {
      const data = await apiGet<Array<AlertRecord & { districtName?: string; wardName?: string; reporterName?: string }>>("/alerts/")
      const normalized = data.map((alert) => ({
        ...alert,
        district: alert.districtName || String(alert.district || ""),
        ward: alert.wardName || String(alert.ward || ""),
        reporter: alert.reporterName || alert.reporter,
      }))
      setAlerts(normalized)
      if (normalized[0]) setSelectedAlertId(normalized[0].id)
      setApiError("")
      return normalized
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load alerts from API."
      if (message.toLowerCase().includes("token")) setUser(null)
      else setApiError(message)
      return [] as AlertRecord[]
    }
  }

  async function refreshIntakes(alertSource = alerts, districtSource = districts) {
    try {
      const data = await apiGet<IntakeRecord[]>("/intakes/")
      const normalized = data.map((intake) => caseFromIntake(intake, alertSource, districtSource))
      setCases(normalized)
      if (normalized[0] && !selectedCaseId) setSelectedCaseId(normalized[0].id)
      setApiError("")
      return normalized
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load intakes from API."
      if (message.toLowerCase().includes("token")) setUser(null)
      else setApiError(message)
      return [] as CaseRecord[]
    }
  }

  async function refreshUsers() {
    try {
      setUsers(await apiGet<ApiUser[]>("/users/"))
    } catch {
      setUsers([])
    }
  }

  async function refreshCalendarTasks() {
    try {
      setCalendarTasks(await apiGet<CalendarTask[]>("/calendar-tasks/"))
    } catch {
      setCalendarTasks([])
    }
  }

  async function login(username: string, password: string, loginPortal: "external" | "internal") {
    setApiError("")
    const session = await apiLogin(username, password, loginPortal)
    if ("passwordChangeRequired" in session) return session
    setUser(session.user)
    setApiError("")
    return session
  }

  async function changePassword(username: string, currentPassword: string, newPassword: string, confirmPassword: string, loginPortal: "external" | "internal") {
    setApiError("")
    const session = await apiChangePassword(username, currentPassword, newPassword, confirmPassword, loginPortal)
    setUser(session.user)
    setApiError("")
    return session
  }

  function logout() {
    apiLogout()
    setUser(null)
  }

  function goToAdmin() {
    window.history.replaceState(null, "", "/login")
    setPortal("admin")
  }

  function goToExternal() {
    window.history.replaceState(null, "", "/")
    setPortal("external")
  }

  async function updateAlert(id: string, changes: Partial<AlertRecord>) {
    setAlerts((items) => items.map((item) => (item.id === id ? { ...item, ...changes } : item)))
    try {
      if (changes.internalStatus === "Ready for Intake") await apiPost(`/alerts/${id}/triage/`, { action: "accept" })
      else if (changes.internalStatus === "More Information Required") await apiPost(`/alerts/${id}/triage/`, { action: "request_more_information", message: "Please provide additional information for intake." })
      else if (changes.internalStatus === "Duplicate Review Required") await apiPost(`/alerts/${id}/triage/`, { action: "duplicate" })
      else if (changes.internalStatus === "Closed - Referred Externally") await apiPost(`/alerts/${id}/triage/`, { action: "refer" })
      else if (changes.internalStatus === "Closed - No Further Action") await apiPost(`/alerts/${id}/triage/`, { action: "close" })
      else if (changes.internalStatus === "Alert Rejected") await apiPost(`/alerts/${id}/triage/`, { action: "reject" })
      else if (changes.internalStatus === "Immediate Action Required") await apiPost(`/alerts/${id}/triage/`, { action: "emergency" })
      await refreshAlerts()
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Workflow action failed.")
      await refreshAlerts()
    }
  }

  async function convertAlertToDraftCase(alert: AlertRecord) {
    const alertParts = alert.id.split("-")
    const caseId = formatCaseNumber(alert.id, alertParts.length >= 4 ? alertParts[2] : districtCodeFromName(alert.district, districts))
    const draftCase: CaseRecord = {
      id: caseId,
      sourceAlertId: alert.id,
      childName: alert.childName,
      sex: alert.sex,
      age: alert.age,
      district: alert.district,
      ward: alert.ward,
      concern: alert.concern,
      riskLevel: alert.riskLevel === "Pending" ? (alert.emergency ? "High" : "Medium") : alert.riskLevel,
      status: "Draft",
      intakeOfficer: alert.intakeOfficer || "Intake Officer",
      createdAt: alert.submittedAt,
      description: alert.description,
      manualMinimumComplete: true,
    }
    try {
      const intake = await apiPost<IntakeRecord>(`/alerts/${alert.id}/convert-to-intake/`, {})
      draftCase.backendIntakeId = intake.id
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not convert alert to intake.")
      return
    }
    setCases((items) => {
      const exists = items.some((item) => item.id === caseId)
      return exists ? items.map((item) => (item.id === caseId ? { ...item, ...draftCase } : item)) : [draftCase, ...items]
    })
    setAlerts((items) =>
      items.map((item) =>
        item.id === alert.id
          ? { ...item, status: "Converted to Case", internalStatus: "Intake In Progress", intakeOfficer: draftCase.intakeOfficer, caseCategory: item.caseCategory === "Uncategorized" ? "Intake Draft" : item.caseCategory }
          : item,
      ),
    )
    const loadedAlerts = await refreshAlerts()
    const loadedCases = await refreshIntakes(loadedAlerts)
    const convertedCase = loadedCases.find((item) => item.sourceAlertId === alert.id) || draftCase
    setSelectedCaseId(convertedCase.id)
    setOpenIntakeCaseId(convertedCase.id)
    setAdminView("case-intake")
  }

  function saveDraftCase(caseRecord: CaseRecord, options: SaveDraftCaseOptions = {}) {
    setCases((items) => {
      const exists = items.some((item) => item.id === caseRecord.id)
      return exists ? items.map((item) => (item.id === caseRecord.id ? { ...item, ...caseRecord, intakeDraft: caseRecord.intakeDraft || item.intakeDraft } : item)) : [caseRecord, ...items]
    })
    setSelectedCaseId(caseRecord.id)
    if (options.openIntake !== false) setAdminView("case-intake")
  }

  function openFullIntake(caseRecord: CaseRecord) {
    setSelectedCaseId(caseRecord.id)
    setOpenIntakeCaseId(caseRecord.id)
    setAdminView("case-intake")
  }

  function discardDraftCase(caseRecord: CaseRecord) {
    setCases((items) => items.filter((item) => item.id !== caseRecord.id && item.backendIntakeId !== caseRecord.backendIntakeId))
    if (selectedCaseId === caseRecord.id) setSelectedCaseId("")
  }

  async function saveCalendarTasks(tasks: CalendarTask[]) {
    await Promise.all(tasks.map((task) => apiPost("/calendar-tasks/", {
      title: task.title,
      detail: task.detail,
      date: task.date,
      urgent: task.urgent,
      source: task.source,
    })))
    await refreshCalendarTasks()
    setCalendarTasks((items) => {
      const next = new Map(items.map((item) => [item.id, item]))
      tasks.forEach((task) => next.set(task.id, task))
      return Array.from(next.values()).sort((a, b) => a.date.localeCompare(b.date))
    })
  }

  async function submitAlert(draft: Pick<AlertRecord, "childName" | "sex" | "age" | "district" | "ward" | "concern" | "danger" | "description"> & {
    child_first_name?: string
    child_surname?: string
    intake_source?: string
    reporting_channel?: string
    information_source_type?: string
    information_source_other?: string
    information_source_name?: string
    information_source_surname?: string
    information_source_first_names?: string
    information_source_id_number?: string
    information_source_sex?: string
    information_source_contact?: string
    information_source_email?: string
    information_source_address?: string
    information_source_relationship_to_child?: string
    information_source_reporter_type?: string
    protect_source_identity?: boolean
    alternative_contact?: string
    source_brief_description?: string
    village_suburb?: string
    nearest_landmark?: string
    current_location?: string
    birth_registered?: string
    birth_certificate_number?: string
    disability?: string
    caregiver_name?: string
    caregiver_contact?: string
    relationship_to_child?: string
    protect_reporter_identity?: boolean
    incident_date?: string | null
    date_reporter_became_aware?: string | null
    incident_location?: string
    alleged_perpetrator_name?: string
    alleged_perpetrator_relationship?: string
    perpetrator_has_access?: string
    immediate_action_taken?: string
    services_contacted?: string
    attachments?: Array<{ name: string; type?: string; url?: string }>
  }): Promise<AlertRecord> {
    try {
      const district = districts.find((item) => item.name === draft.district)
      if (!district) throw new Error("Select a captured district before submitting the alert.")
      const ward = wards.find((item) => item.name === draft.ward && item.district === district.id)
      const created = await apiPost<AlertRecord & { districtName?: string; wardName?: string; reporterName?: string }>("/alerts/", {
        child_first_name: draft.child_first_name || (draft.childName === "Unknown child" ? "" : draft.childName),
        child_surname: draft.child_surname || "",
        sex: draft.sex,
        age: draft.age,
        district: district.id,
        ward: ward?.id,
        current_location: draft.current_location || draft.district,
        village_suburb: draft.village_suburb || "",
        nearest_landmark: draft.nearest_landmark || "",
        birth_registered: draft.birth_registered || "Unknown",
        birth_certificate_number: draft.birth_certificate_number || "",
        disability: draft.disability || "Unknown",
        caregiver_name: draft.caregiver_name || "",
        caregiver_contact: draft.caregiver_contact || "",
        relationship_to_child: draft.relationship_to_child || "",
        protect_reporter_identity: Boolean(draft.protect_reporter_identity),
        incident_date: draft.incident_date || null,
        date_reporter_became_aware: draft.date_reporter_became_aware || null,
        incident_location: draft.incident_location || "",
        alleged_perpetrator_name: draft.alleged_perpetrator_name || "",
        alleged_perpetrator_relationship: draft.alleged_perpetrator_relationship || "",
        perpetrator_has_access: draft.perpetrator_has_access || "Unknown",
        immediate_action_taken: draft.immediate_action_taken || "",
        services_contacted: draft.services_contacted || "",
        attachments: draft.attachments || [],
        intake_source: draft.intake_source || "ALERT",
        reporting_channel: draft.reporting_channel || "",
        information_source_type: draft.information_source_type || "",
        information_source_other: draft.information_source_other || "",
        information_source_name: draft.information_source_name || "",
        information_source_surname: draft.information_source_surname || "",
        information_source_first_names: draft.information_source_first_names || "",
        information_source_id_number: draft.information_source_id_number || "",
        information_source_sex: draft.information_source_sex || "",
        information_source_contact: draft.information_source_contact || "",
        information_source_email: draft.information_source_email || "",
        information_source_address: draft.information_source_address || "",
        information_source_relationship_to_child: draft.information_source_relationship_to_child || "",
        information_source_reporter_type: draft.information_source_reporter_type || "",
        protect_source_identity: Boolean(draft.protect_source_identity),
        alternative_contact: draft.alternative_contact || "",
        source_brief_description: draft.source_brief_description || "",
        concern_categories: [draft.concern],
        danger_screening: Object.fromEntries(draft.danger.map((item) => [item, "Yes"])),
        description: draft.description,
      })
      const normalized = { ...created, district: created.districtName || draft.district, ward: created.wardName || draft.ward, reporter: created.reporterName || "Reporter" }
      setAlerts((items) => [normalized, ...items])
      setSelectedAlertId(normalized.id)
      return normalized
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not submit alert to API.")
      throw error
    }
  }

  return (
    <>
      <OfflineStatus online={online} pendingSync={pendingSync} />
      {portal === "external" ? (
        <ExternalPortal alerts={alerts} onSubmitAlert={submitAlert} onAdmin={goToAdmin} view={externalView} setView={setExternalView} user={user} login={login} changePassword={changePassword} logout={logout} apiError={apiError} districts={districts} wards={wards} />
      ) : (
        <AdminPortal
          alerts={alerts}
          cases={cases}
          selectedAlert={selectedAlert}
          selectedCase={selectedCase}
          calendarTasks={calendarTasks}
          setSelectedAlertId={setSelectedAlertId}
          setSelectedCaseId={setSelectedCaseId}
          updateAlert={updateAlert}
          convertAlertToDraftCase={convertAlertToDraftCase}
          saveDraftCase={saveDraftCase}
          discardDraftCase={discardDraftCase}
          openFullIntake={openFullIntake}
          onExternal={goToExternal}
          view={adminView}
          setView={setAdminView}
          user={user}
          login={login}
          changePassword={changePassword}
          logout={logout}
          apiError={apiError}
          users={users}
          organizations={organizations}
          provinces={provinces}
          districts={districts}
          wards={wards}
          refreshUsers={refreshUsers}
          refreshAlerts={refreshAlerts}
          saveCalendarTasks={saveCalendarTasks}
          sidebarCollapsed={internalSidebarCollapsed}
          setSidebarCollapsed={setInternalSidebarCollapsed}
          openIntakeCaseId={openIntakeCaseId}
          clearOpenIntakeCaseId={() => setOpenIntakeCaseId("")}
        />
      )}
    </>
  )
}

function OfflineStatus({ online, pendingSync }: { online: boolean; pendingSync: number }) {
  if (online && pendingSync === 0) return null
  return (
    <div className={`sticky top-0 z-[60] flex items-center justify-center gap-2 px-4 py-2 text-sm font-bold shadow-sm ${online ? "bg-[#fff7ed] text-[#9a3412]" : "bg-[#102033] text-white"}`}>
      {online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      <span>{online ? `${pendingSync} offline change${pendingSync === 1 ? "" : "s"} waiting to sync.` : `Offline mode active${pendingSync ? ` - ${pendingSync} pending sync` : ""}.`}</span>
    </div>
  )
}

function ExternalPortal({
  alerts,
  onSubmitAlert,
  onAdmin,
  view,
  setView,
  user,
  login,
  changePassword,
  logout,
  apiError,
  districts,
  wards,
}: {
  alerts: AlertRecord[]
  onSubmitAlert: (draft: Pick<AlertRecord, "childName" | "sex" | "age" | "district" | "ward" | "concern" | "danger" | "description"> & {
    child_first_name?: string
    child_surname?: string
    intake_source?: string
    reporting_channel?: string
    information_source_type?: string
    information_source_other?: string
    information_source_name?: string
    information_source_surname?: string
    information_source_first_names?: string
    information_source_id_number?: string
    information_source_sex?: string
    information_source_contact?: string
    information_source_email?: string
    information_source_address?: string
    information_source_relationship_to_child?: string
    information_source_reporter_type?: string
    protect_source_identity?: boolean
    alternative_contact?: string
    source_brief_description?: string
    village_suburb?: string
    nearest_landmark?: string
    current_location?: string
    birth_registered?: string
    birth_certificate_number?: string
    disability?: string
    caregiver_name?: string
    caregiver_contact?: string
    relationship_to_child?: string
    protect_reporter_identity?: boolean
    incident_date?: string | null
    date_reporter_became_aware?: string | null
    incident_location?: string
    alleged_perpetrator_name?: string
    alleged_perpetrator_relationship?: string
    perpetrator_has_access?: string
    immediate_action_taken?: string
    services_contacted?: string
    attachments?: Array<{ name: string; type?: string; url?: string }>
  }) => Promise<AlertRecord>
  onAdmin: () => void
  view: string
  setView: (view: string) => void
  user: ApiUser | null
  login: (username: string, password: string, loginPortal: "external" | "internal") => Promise<unknown>
  changePassword: (username: string, currentPassword: string, newPassword: string, confirmPassword: string, loginPortal: "external" | "internal") => Promise<unknown>
  logout: () => void
  apiError: string
  districts: DistrictOption[]
  wards: WardOption[]
}) {
  const attendedCases = alerts.filter((alert) => alert.status === "Converted to Case" || alert.status === "Intake In Progress" || alert.internalStatus === "Intake In Progress").length
  const metrics: Metric[] = [
    { label: "Submitted", value: alerts.length, icon: Send, tone: "bg-[#008c7a]" },
    { label: "Attended cases", value: attendedCases, icon: ClipboardCheck, tone: "bg-[#2e6fa3]" },
    { label: "Emergency", value: alerts.filter((a) => a.emergency).length, icon: ShieldAlert, tone: "bg-[#b42318]" },
  ]
  const notificationCount = alerts.length
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  if (!user) return <PublicLogin login={login} changePassword={changePassword} apiError={apiError} />

  const navItems: [string, string, ElementType][] = [
    ["dashboard", "Dashboard", LayoutDashboard],
    ["raise", "Raise Alert", Plus],
  ]

  return (
    <main className="min-h-screen bg-[#eef2f5] text-[#27364d]">
      <header className="border-b border-[#d8dee8] bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <img className="h-12 w-12 shrink-0 object-contain" src={coatOfArms} alt="National coat of arms" />
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold text-[#263747]">NCMIS Public Portal</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="relative grid h-10 w-10 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#263747]" title="Notifications" onClick={() => setView("notifications")}>
              {notificationCount > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#ef5350] px-1 text-[11px] font-bold text-white">{notificationCount}</span>}
              <Bell className="h-5 w-5" />
            </button>
            <div className="relative">
              <button className="inline-flex h-10 items-center gap-2 rounded-md border border-[#d8dee8] bg-white px-3 text-sm font-semibold text-[#263747]" onClick={() => setUserMenuOpen((open) => !open)}>
                <UserCheck className="h-4 w-4" />
                <span className="max-w-[120px] truncate">{user.username}</span>
                <ChevronDown className="h-4 w-4" />
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 top-12 z-20 w-56 rounded-md border border-[#d8dee8] bg-white py-2 shadow-lg">
                  <button className="block w-full px-4 py-2 text-left text-sm font-semibold text-[#263747] hover:bg-[#f1f5f9]" onClick={() => { setView("profile"); setUserMenuOpen(false) }}>Profile</button>
                  <div className="border-t border-[#edf0f4] px-4 py-2 text-xs text-[#64748b]">{user.profile.roleLabel}</div>
                  <button className="block w-full px-4 py-2 text-left text-sm font-semibold text-[#b42318] hover:bg-[#fef2f2]" onClick={logout}>Logout</button>
                </div>
              )}
            </div>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl flex-wrap gap-2 px-3 pb-3 sm:px-4">
          {navItems.map(([key, label, Icon]) => (
            <button key={key} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold sm:flex-none ${view === key ? "border-[#008c7a] bg-[#008c7a] text-white" : "border-[#d8dee8] bg-white text-[#263747]"}`} onClick={() => setView(key)}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </nav>
      </header>
      <section className="mx-auto min-w-0 max-w-7xl space-y-6 px-3 py-4 sm:px-4 sm:py-6">
        {apiError && <ErrorBanner message={apiError} />}
        {view === "dashboard" && <Dashboard title="My Submitted Alerts" metrics={metrics} alerts={alerts} limited />}
        {view === "raise" && <AlertForm onSubmitAlert={onSubmitAlert} onSubmittedOk={() => setView("dashboard")} districts={districts} wards={wards} user={user} />}
        {view === "notifications" && <PublicNotifications alerts={alerts} onViewAlert={() => setView("dashboard")} />}
        {view === "profile" && <ProfilePanel />}
      </section>
    </main>
  )
}

function AlertForm({
  onSubmitAlert,
  onSubmittedOk,
  districts,
  wards,
  user,
}: {
  onSubmitAlert: (draft: Pick<AlertRecord, "childName" | "sex" | "age" | "district" | "ward" | "concern" | "danger" | "description"> & {
    child_first_name?: string
    child_surname?: string
    intake_source?: string
    reporting_channel?: string
    information_source_type?: string
    information_source_other?: string
    information_source_name?: string
    information_source_surname?: string
    information_source_first_names?: string
    information_source_id_number?: string
    information_source_sex?: string
    information_source_contact?: string
    information_source_email?: string
    information_source_address?: string
    information_source_relationship_to_child?: string
    information_source_reporter_type?: string
    protect_source_identity?: boolean
    alternative_contact?: string
    source_brief_description?: string
    village_suburb?: string
    nearest_landmark?: string
    current_location?: string
    birth_registered?: string
    birth_certificate_number?: string
    disability?: string
    caregiver_name?: string
    caregiver_contact?: string
    relationship_to_child?: string
    protect_reporter_identity?: boolean
    incident_date?: string | null
    date_reporter_became_aware?: string | null
    incident_location?: string
    alleged_perpetrator_name?: string
    alleged_perpetrator_relationship?: string
    perpetrator_has_access?: string
    immediate_action_taken?: string
    services_contacted?: string
    attachments?: Array<{ name: string; type?: string; url?: string }>
  }) => Promise<AlertRecord>
  onSubmittedOk: () => void
  districts: DistrictOption[]
  wards: WardOption[]
  user: ApiUser
}) {
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState({
    intake_source: "ALERT",
    date_reported: "",
    reporting_channel: "",
    district: "",
    ward: "",
    village: "",
    nearest_landmark: "",
    emergency_reported: "",
    immediate_danger_reported: "",
    attachments: "",
    concern_summary: "",
    reporter_narrative: "",
    informant_relationship_to_child: "",
    informant_phone: "",
    information_source_type: "",
    information_source_other: "",
    information_source_name: "",
    information_source_surname: "",
    information_source_first_names: "",
    information_source_id_number: "",
    information_source_sex: "",
    information_source_contact: "",
    information_source_email: "",
    information_source_address: "",
    information_source_reporter_type: "",
    protect_source_identity: "",
    source_brief_description: "",
    child_known: "",
    child_first_name: "",
    child_surname: "",
    sex: "",
    age: "",
    child_current_location: "",
    birth_registered: "",
    birth_certificate_number: "",
    disability: "",
    caregiver_name: "",
    caregiver_contact: "",
    caregiver_relationship_to_child: "",
    protect_reporter_identity: "",
    concern: "",
    other_concern: "",
    other_danger: "",
    incident_date: "",
    date_reporter_became_aware: "",
    incident_location: "",
    alleged_perpetrator_name: "",
    alleged_perpetrator_relationship: "",
    perpetrator_has_access: "",
    immediate_action_taken: "",
    services_contacted: "",
  })
  const [danger, setDanger] = useState<string[]>([])
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [attachments, setAttachments] = useState<Array<{ name: string; url: string; type: string }>>([])
  const [declarationAccepted, setDeclarationAccepted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submittedAlert, setSubmittedAlert] = useState<AlertRecord | null>(null)
  const steps = ["Summary", "Reporter & Source", "Child", "Concern & Danger", "Attachments", "Submit"]

  function toggleDanger(item: string) {
    setDanger((items) => {
      const next = items.includes(item) ? items.filter((value) => value !== item) : [...items, item]
      setDraft((current) => ({ ...current, immediate_danger_reported: next.length ? "Yes" : "No", emergency_reported: next.length ? "Yes" : current.emergency_reported }))
      return next
    })
  }

  function toggleCategory(item: string) {
    setSelectedCategories((items) => {
      const next = items.includes(item) ? items.filter((value) => value !== item) : [...items, item]
      setDraft((current) => ({ ...current, concern: next[0] || "" }))
      return next
    })
  }

  function setDraftValue(key: string, value: string) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function addAttachments(files: FileList | null) {
    if (!files?.length) return
    const uploaded = Array.from(files).map((file) => ({ name: file.name, url: URL.createObjectURL(file), type: file.type }))
    setAttachments((items) => {
      const next = [...items, ...uploaded]
      setDraftValue("attachments", `${next.length} attachment${next.length === 1 ? "" : "s"} selected`)
      return next
    })
  }

  function openAttachment(file: { name: string; url: string }) {
    const tab = window.open(file.url, "_blank", "noopener,noreferrer")
    if (tab) tab.document.title = file.name
  }

  async function submitPublicAlert() {
    if (!declarationAccepted || submitting) return
    setSubmitting(true)
    try {
      const created = await onSubmitAlert({
        childName: submittedChildName,
        child_first_name: submittedChildFirstName,
        child_surname: submittedChildSurname,
        sex: submittedSex,
        age: submittedAge,
        district: draft.district,
        ward: draft.ward,
        concern: submittedConcern,
        danger,
        description: submittedDescription,
        intake_source: draft.intake_source,
        reporting_channel: draft.reporting_channel,
        information_source_type: draft.information_source_type,
        information_source_other: draft.information_source_other,
        information_source_name: [draft.information_source_first_names, draft.information_source_surname].filter(Boolean).join(" ") || draft.information_source_name,
        information_source_surname: draft.information_source_surname,
        information_source_first_names: draft.information_source_first_names,
        information_source_id_number: draft.information_source_id_number,
        information_source_sex: draft.information_source_sex,
        information_source_contact: draft.information_source_contact,
        information_source_email: draft.information_source_email,
        information_source_address: draft.information_source_address,
        information_source_relationship_to_child: draft.informant_relationship_to_child,
        information_source_reporter_type: draft.information_source_reporter_type,
        protect_source_identity: draft.protect_source_identity === "Yes",
        alternative_contact: draft.informant_phone,
        source_brief_description: draft.source_brief_description,
        village_suburb: draft.village,
        nearest_landmark: draft.nearest_landmark,
        current_location: draft.child_current_location || draft.district,
        birth_registered: draft.birth_registered,
        birth_certificate_number: draft.birth_certificate_number,
        disability: draft.disability,
        caregiver_name: draft.caregiver_name,
        caregiver_contact: draft.caregiver_contact,
        relationship_to_child: draft.caregiver_relationship_to_child,
        protect_reporter_identity: draft.protect_reporter_identity === "Yes",
        incident_date: draft.incident_date || null,
        date_reporter_became_aware: draft.date_reporter_became_aware || null,
        incident_location: draft.incident_location,
        alleged_perpetrator_name: draft.alleged_perpetrator_name,
        alleged_perpetrator_relationship: draft.alleged_perpetrator_relationship,
        perpetrator_has_access: draft.perpetrator_has_access,
        immediate_action_taken: draft.immediate_action_taken,
        services_contacted: draft.services_contacted,
        attachments: attachments.map((file) => ({ name: file.name, type: file.type, url: file.url })),
      })
      setSubmittedAlert(created)
    } finally {
      setSubmitting(false)
    }
  }

  function acknowledgeSubmittedAlert() {
    setSubmittedAlert(null)
    onSubmittedOk()
  }

  const submittedChildFirstName = draft.child_known === "No" ? "" : draft.child_first_name.trim()
  const submittedChildSurname = draft.child_known === "No" ? "" : draft.child_surname.trim()
  const submittedChildName = draft.child_known === "No" ? "Unknown child" : [submittedChildFirstName, submittedChildSurname].filter(Boolean).join(" ") || "Unknown child"
  const submittedSex = draft.sex || "Unknown"
  const submittedAge = draft.age || "Unknown"
  const submittedConcern = [
    ...selectedCategories.filter((item) => item !== "Other"),
    ...(selectedCategories.includes("Other") && draft.other_concern.trim() ? [`Other: ${draft.other_concern.trim()}`] : []),
  ].join(", ") || "Uncategorized"
  const submittedDescription = draft.reporter_narrative || draft.concern_summary

  return (
    <Panel title="Raise New Alert" icon={ShieldAlert} action={`Step ${step + 1} of ${steps.length}`}>
      <div className="mb-5 flex flex-wrap gap-2 border-b border-[#d8dee8] pb-3">
        {steps.map((label, index) => (
          <button
            key={label}
            className={`min-h-11 flex-1 rounded-md border px-3 text-sm font-semibold sm:flex-none sm:min-w-[150px] ${index === step ? "border-[#008c7a] bg-[#008c7a] text-white" : "border-[#d8dee8] bg-white text-[#50617a]"}`}
            onClick={() => setStep(index)}
          >
            {label}
          </button>
        ))}
      </div>

      {step === 0 && (
        <section className="rounded-md border border-[#d8dee8] bg-white p-4 sm:p-6">
          <h3 className="mb-4 text-[20px] font-bold text-[#10233f]">Alert Summary</h3>
          <FormGrid>
            <ReadonlyField label="Alert ID" value="Generated after submit" />
            <Field label="Date reported"><input className={inputClass} type="date" value={draft.date_reported} onChange={(e) => setDraftValue("date_reported", e.target.value)} /></Field>
            <Field label="Reporting channel">
              <select className={inputClass} value={draft.reporting_channel} onChange={(e) => setDraftValue("reporting_channel", e.target.value)}>
                <option value="">Select reporting channel</option>
                <option>Public portal</option>
                <option>Phone call</option>
                <option>Walk-in</option>
                <option>Community outreach</option>
                <option>Partner referral</option>
                <option>Police referral</option>
                <option>School referral</option>
                <option>Health facility referral</option>
                <option>Other</option>
              </select>
            </Field>
            <Field label="District"><select className={inputClass} value={draft.district} onChange={(e) => setDraft((current) => ({ ...current, district: e.target.value, ward: wards.find((ward) => ward.districtName === e.target.value)?.name || "" }))}><option value="">Select district</option>{districts.map((district) => <option key={district.id}>{district.name}</option>)}</select></Field>
            <Field label="Ward"><select className={inputClass} value={draft.ward} onChange={(e) => setDraftValue("ward", e.target.value)}><option value="">Select ward</option>{wards.filter((ward) => ward.districtName === draft.district).map((ward) => <option key={ward.id}>{ward.name}</option>)}</select></Field>
            <Field label="Village"><input className={inputClass} value={draft.village} onChange={(e) => setDraftValue("village", e.target.value)} /></Field>
            <Field label="Nearest landmark"><input className={inputClass} value={draft.nearest_landmark} onChange={(e) => setDraftValue("nearest_landmark", e.target.value)} placeholder="School, clinic, shop, church, road, or known place nearby" /></Field>
            <Field label="Emergency reported"><select className={inputClass} value={draft.emergency_reported} onChange={(e) => setDraftValue("emergency_reported", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
            <Field label="Immediate danger reported"><select className={inputClass} value={draft.immediate_danger_reported} onChange={(e) => setDraftValue("immediate_danger_reported", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
            <ReadonlyField label="Attachments" value={draft.attachments} />
            <div className="md:col-span-2"><Field label="Brief concern summary"><textarea className={`${inputClass} min-h-[110px] py-3`} value={draft.concern_summary} onChange={(e) => setDraftValue("concern_summary", e.target.value)} /></Field></div>
            <div className="md:col-span-2"><Field label="Reporter narrative"><textarea className={`${inputClass} min-h-[130px] py-3`} value={draft.reporter_narrative} onChange={(e) => setDraftValue("reporter_narrative", e.target.value)} /></Field></div>
          </FormGrid>
        </section>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <h3 className="mb-3 text-base font-bold text-[#263747]">Submitted by</h3>
            <FormGrid>
              <ReadonlyField label="Reporter name" value={`${user.first_name} ${user.last_name}`.trim() || user.username} />
              <ReadonlyField label="Role" value={user.profile.roleLabel} />
              <ReadonlyField label="Organization" value={user.profile.organizationName || "External organization"} />
              <ReadonlyField label="Reporter contact" value={user.profile.phone || user.email || "Not captured"} />
            </FormGrid>
          </section>
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <h3 className="mb-3 text-base font-bold text-[#263747]">Information source</h3>
            <FormGrid>
              <Field label="Source type">
                <select className={inputClass} value={draft.information_source_type} onChange={(e) => setDraftValue("information_source_type", e.target.value)}>
                  <option value="">Select source type</option>
                  <option>Parent</option>
                  <option>Guardian</option>
                  <option>Child self-report</option>
                  <option>Neighbour</option>
                  <option>Community member</option>
                  <option>Teacher</option>
                  <option>Nurse / health worker</option>
                  <option>Police</option>
                  <option>NGO worker</option>
                  <option>Anonymous source</option>
                  <option>Other</option>
                </select>
              </Field>
              {draft.information_source_type === "Other" && (
                <Field label="Specify other source"><input className={inputClass} value={draft.information_source_other} onChange={(e) => setDraftValue("information_source_other", e.target.value)} /></Field>
              )}
              <Field label="Surname"><input className={inputClass} value={draft.information_source_surname} onChange={(e) => setDraftValue("information_source_surname", e.target.value)} placeholder="Leave blank if anonymous" /></Field>
              <Field label="First names"><input className={inputClass} value={draft.information_source_first_names} onChange={(e) => setDraftValue("information_source_first_names", e.target.value)} placeholder="Leave blank if anonymous" /></Field>
              <Field label="ID number"><input className={inputClass} value={draft.information_source_id_number} onChange={(e) => setDraftValue("information_source_id_number", e.target.value)} /></Field>
              <Field label="Sex">
                <select className={inputClass} value={draft.information_source_sex} onChange={(e) => setDraftValue("information_source_sex", e.target.value)}>
                  <option value="">Select sex</option>
                  <option>FEMALE</option>
                  <option>MALE</option>
                  <option>UNKNOWN</option>
                </select>
              </Field>
              <Field label="Source contact"><input className={inputClass} value={draft.information_source_contact} onChange={(e) => setDraftValue("information_source_contact", e.target.value)} placeholder="+263 ..." /></Field>
              <Field label="Email"><input className={inputClass} type="email" value={draft.information_source_email} onChange={(e) => setDraftValue("information_source_email", e.target.value)} /></Field>
              <Field label="Address"><input className={inputClass} value={draft.information_source_address} onChange={(e) => setDraftValue("information_source_address", e.target.value)} /></Field>
              <Field label="Relationship to child">
                <select className={inputClass} value={draft.informant_relationship_to_child} onChange={(e) => setDraftValue("informant_relationship_to_child", e.target.value)}>
                  <option value="">Select relationship</option>
                  <option>Parent</option>
                  <option>Guardian</option>
                  <option>Relative</option>
                  <option>Teacher</option>
                  <option>Health worker</option>
                  <option>Police officer</option>
                  <option>Neighbour</option>
                  <option>Community worker</option>
                  <option>Unknown</option>
                </select>
              </Field>
              <Field label="Reporter type">
                <select className={inputClass} value={draft.information_source_reporter_type} onChange={(e) => setDraftValue("information_source_reporter_type", e.target.value)}>
                  <option value="">Select reporter type</option>
                  <option>Parent / caregiver</option>
                  <option>Child</option>
                  <option>Relative</option>
                  <option>Neighbour</option>
                  <option>Community member</option>
                  <option>CCW</option>
                  <option>Teacher</option>
                  <option>Health worker</option>
                  <option>Police</option>
                  <option>NGO / FBO worker</option>
                  <option>Anonymous</option>
                  <option>Other</option>
                </select>
              </Field>
              <Field label="Protect source identity">
                <select className={inputClass} value={draft.protect_source_identity} onChange={(e) => setDraftValue("protect_source_identity", e.target.value)}>
                  <option value="">Select</option>
                  <option>Yes</option>
                  <option>No</option>
                </select>
              </Field>
              <Field label="Alternative contact"><input className={inputClass} value={draft.informant_phone} onChange={(e) => setDraftValue("informant_phone", e.target.value)} placeholder="+263 ..." /></Field>
              <div className="md:col-span-2">
                <Field label="Brief source description"><textarea className={`${inputClass} min-h-[90px] py-3`} value={draft.source_brief_description} onChange={(e) => setDraftValue("source_brief_description", e.target.value)} placeholder="Optional note about how the information was received or any context from the source" /></Field>
              </div>
            </FormGrid>
          </section>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <h3 className="mb-3 text-base font-bold text-[#263747]">Child Details</h3>
            <FormGrid>
              <Field label="Child known"><select className={inputClass} value={draft.child_known} onChange={(e) => setDraftValue("child_known", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
              <Field label="Child first name"><input className={`${inputClass} ${draft.child_known === "No" ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={draft.child_known === "No" ? "Unknown child" : draft.child_first_name} onChange={(e) => setDraftValue("child_first_name", e.target.value)} disabled={draft.child_known === "No"} /></Field>
              <Field label="Child surname"><input className={`${inputClass} ${draft.child_known === "No" ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={draft.child_known === "No" ? "Unknown child" : draft.child_surname} onChange={(e) => setDraftValue("child_surname", e.target.value)} disabled={draft.child_known === "No"} /></Field>
              <Field label="Sex"><select className={inputClass} value={draft.sex} onChange={(e) => setDraftValue("sex", e.target.value)}><option value="">Select sex</option><option>Female</option><option>Male</option><option>Unknown</option></select></Field>
              <Field label="Age"><input className={inputClass} value={draft.age} onChange={(e) => setDraftValue("age", e.target.value)} placeholder="Enter age or estimated age" /></Field>
              <Field label="Child current location"><input className={inputClass} value={draft.child_current_location} onChange={(e) => setDraftValue("child_current_location", e.target.value)} placeholder={draft.district} /></Field>
              <Field label="Birth registered"><select className={inputClass} value={draft.birth_registered} onChange={(e) => setDraftValue("birth_registered", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
              <Field label="Birth certificate number"><input className={inputClass} value={draft.birth_certificate_number} onChange={(e) => setDraftValue("birth_certificate_number", e.target.value)} /></Field>
              <Field label="Disability"><select className={inputClass} value={draft.disability} onChange={(e) => setDraftValue("disability", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
            </FormGrid>
          </section>
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <h3 className="mb-3 text-base font-bold text-[#263747]">Caregiver / Household</h3>
            <FormGrid>
              <Field label="Caregiver name"><input className={inputClass} value={draft.caregiver_name} onChange={(e) => setDraftValue("caregiver_name", e.target.value)} /></Field>
              <Field label="Caregiver contact"><input className={inputClass} value={draft.caregiver_contact} onChange={(e) => setDraftValue("caregiver_contact", e.target.value)} placeholder="+263 ..." /></Field>
              <Field label="Relationship to child"><input className={inputClass} value={draft.caregiver_relationship_to_child} onChange={(e) => setDraftValue("caregiver_relationship_to_child", e.target.value)} /></Field>
              <Field label="Protect caregiver identity"><select className={inputClass} value={draft.protect_reporter_identity} onChange={(e) => setDraftValue("protect_reporter_identity", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
            </FormGrid>
          </section>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <h3 className="mb-3 text-base font-bold text-[#263747]">Case Categories / Concerns</h3>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {[...concernCategories, "Other"].map((item) => (
                <label key={item} className={`rounded-md border p-3 text-sm font-semibold ${selectedCategories.includes(item) ? "border-[#008c7a] bg-[#e7f6f3] text-[#007464]" : "border-[#d8dee8] bg-white text-[#263747]"}`}>
                  <input className="mr-2 accent-[#008c7a]" type="checkbox" checked={selectedCategories.includes(item)} onChange={() => toggleCategory(item)} />
                  {item}
                </label>
              ))}
            </div>
            {selectedCategories.includes("Other") && (
              <div className="mt-4 max-w-xl">
                <Field label="Specify other concern"><input className={inputClass} value={draft.other_concern} onChange={(event) => setDraftValue("other_concern", event.target.value)} /></Field>
              </div>
            )}
          </section>
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <h3 className="mb-3 text-base font-bold text-[#263747]">Immediate Danger Screening</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {[...dangerQuestions, "Other"].map((item) => (
                <label key={item} className="flex items-center justify-between gap-3 rounded-md border border-[#d8dee8] bg-[#f8fafc] p-3 text-sm font-semibold">
                  <span>{item}</span>
                  <input type="checkbox" className="h-5 w-5 accent-[#b42318]" checked={danger.includes(item)} onChange={() => toggleDanger(item)} />
                </label>
              ))}
            </div>
            {danger.includes("Other") && (
              <div className="mt-4 max-w-xl">
                <Field label="Specify other danger"><input className={inputClass} value={draft.other_danger} onChange={(event) => setDraftValue("other_danger", event.target.value)} /></Field>
              </div>
            )}
          </section>
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <h3 className="mb-3 text-base font-bold text-[#263747]">Incident & Action Already Taken</h3>
            <FormGrid>
              <Field label="Incident date"><input className={inputClass} type="date" value={draft.incident_date} onChange={(e) => setDraftValue("incident_date", e.target.value)} /></Field>
              <Field label="Date reporter became aware"><input className={inputClass} type="date" value={draft.date_reporter_became_aware} onChange={(e) => setDraftValue("date_reporter_became_aware", e.target.value)} /></Field>
              <Field label="Incident location"><input className={inputClass} value={draft.incident_location} onChange={(e) => setDraftValue("incident_location", e.target.value)} /></Field>
              <Field label="Alleged perpetrator name"><input className={inputClass} value={draft.alleged_perpetrator_name} onChange={(e) => setDraftValue("alleged_perpetrator_name", e.target.value)} /></Field>
              <Field label="Alleged perpetrator relationship"><input className={inputClass} value={draft.alleged_perpetrator_relationship} onChange={(e) => setDraftValue("alleged_perpetrator_relationship", e.target.value)} /></Field>
              <Field label="Perpetrator has access"><select className={inputClass} value={draft.perpetrator_has_access} onChange={(e) => setDraftValue("perpetrator_has_access", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
              <div className="md:col-span-2"><Field label="Immediate action taken"><textarea className={`${inputClass} min-h-[90px] py-3`} value={draft.immediate_action_taken} onChange={(e) => setDraftValue("immediate_action_taken", e.target.value)} /></Field></div>
              <div className="md:col-span-2"><Field label="Services contacted"><textarea className={`${inputClass} min-h-[90px] py-3`} value={draft.services_contacted} onChange={(e) => setDraftValue("services_contacted", e.target.value)} /></Field></div>
            </FormGrid>
          </section>
        </div>
      )}

      {step === 4 && (
        <div className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-5">
          <div className="font-semibold text-[#27364d]">Optional attachments</div>
          <p className="mt-1 text-sm text-[#64748b]">Photo, document, referral letter, police report, medical note, or school note can be added later. Do not upload explicit, degrading, or unnecessary images of children.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-[#d8dee8] bg-white px-4 text-sm font-semibold text-[#27364d]">
              <File className="h-4 w-4" /> Upload media or document
              <input className="hidden" type="file" multiple accept="image/*,.pdf,.doc,.docx" onChange={(event) => addAttachments(event.target.files)} />
            </label>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-[#d8dee8] bg-white px-4 text-sm font-semibold text-[#27364d]">
              <Eye className="h-4 w-4" /> Take photo
              <input className="hidden" type="file" accept="image/*" capture="environment" onChange={(event) => addAttachments(event.target.files)} />
            </label>
          </div>
          {attachments.length > 0 && (
            <div className="mt-4 rounded-md border border-[#d8dee8] bg-white p-3">
              <div className="mb-2 text-sm font-bold text-[#263747]">Selected files</div>
              <div className="grid gap-2 md:grid-cols-2">
                {attachments.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 rounded-md bg-[#f8fafc] px-3 py-2 text-sm font-semibold text-[#263747]">
                    <span className="min-w-0 truncate">{file.name}</span>
                    <button className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#263747]" title="Open attachment in new tab" onClick={() => openAttachment(file)}>
                      <Eye className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 5 && (
        <div className="space-y-4">
          <Summary alert={{ ...emptyAlert, id: "Generated after submit", childName: submittedChildName, sex: submittedSex, age: submittedAge, district: draft.district, ward: draft.ward, concern: submittedConcern, description: submittedDescription, danger, emergency: danger.length > 0 || draft.emergency_reported === "Yes" }} />
          <label className="flex items-center gap-3 rounded-md bg-[#f8fafc] p-3 text-sm">
            <input type="checkbox" checked={declarationAccepted} onChange={(event) => setDeclarationAccepted(event.target.checked)} className="h-5 w-5 accent-[#008c7a]" />
            Information is true to the best of my knowledge and submitted for child protection/welfare purposes.
          </label>
        </div>
      )}

      <div className="mt-6 flex flex-wrap justify-between gap-3 border-t border-[#dfe4eb] pt-4">
        <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 text-sm font-semibold" onClick={() => setStep(Math.max(0, step - 1))}>Back</button>
        {step < steps.length - 1 ? (
          <button className="inline-flex items-center gap-2 rounded-md bg-[#008c7a] px-5 py-2 text-sm font-semibold text-white" onClick={() => setStep(Math.min(steps.length - 1, step + 1))}>Next <ArrowRight className="h-4 w-4" /></button>
        ) : (
          <button className="inline-flex items-center gap-2 rounded-md bg-[#008c7a] px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45" disabled={!declarationAccepted || submitting} onClick={submitPublicAlert}><Send className="h-4 w-4" /> {submitting ? "Submitting..." : "Submit alert"}</button>
        )}
      </div>
      {submittedAlert && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="w-full max-w-md rounded-md border border-[#cfe4df] bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#e7f6f3] text-[#008c7a]">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-xl font-bold text-[#263747]">Alert submitted successfully</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7191]">Alert {submittedAlert.id} has been submitted successfully.</p>
            <button className="mt-6 h-11 rounded-md bg-[#008c7a] px-8 font-semibold text-white hover:bg-[#007767]" onClick={acknowledgeSubmittedAlert}>OK</button>
          </div>
        </div>
      )}
    </Panel>
  )
}

function AdminPortal({
  alerts,
  cases,
  selectedAlert,
  selectedCase,
  calendarTasks,
  setSelectedAlertId,
  setSelectedCaseId,
  updateAlert,
  convertAlertToDraftCase,
  saveDraftCase,
  discardDraftCase,
  openFullIntake,
  onExternal,
  view,
  setView,
  user,
  login,
  changePassword,
  logout,
  apiError,
  users,
  organizations,
  provinces,
  districts,
  wards,
  refreshUsers,
  refreshAlerts,
  saveCalendarTasks,
  sidebarCollapsed,
  setSidebarCollapsed,
  openIntakeCaseId,
  clearOpenIntakeCaseId,
}: {
  alerts: AlertRecord[]
  cases: CaseRecord[]
  selectedAlert: AlertRecord
  selectedCase?: CaseRecord
  calendarTasks: CalendarTask[]
  setSelectedAlertId: (id: string) => void
  setSelectedCaseId: (id: string) => void
  updateAlert: (id: string, changes: Partial<AlertRecord>) => void
  convertAlertToDraftCase: (alert: AlertRecord) => void | Promise<void>
  saveDraftCase: (caseRecord: CaseRecord, options?: SaveDraftCaseOptions) => void
  discardDraftCase: (caseRecord: CaseRecord) => void
  openFullIntake: (caseRecord: CaseRecord) => void
  onExternal: () => void
  view: string
  setView: (view: string) => void
  user: ApiUser | null
  login: (username: string, password: string, loginPortal: "external" | "internal") => Promise<unknown>
  changePassword: (username: string, currentPassword: string, newPassword: string, confirmPassword: string, loginPortal: "external" | "internal") => Promise<unknown>
  logout: () => void
  apiError: string
  users: ApiUser[]
  organizations: OrganizationOption[]
  provinces: ProvinceOption[]
  districts: DistrictOption[]
  wards: WardOption[]
  refreshUsers: () => Promise<void>
  refreshAlerts: () => Promise<AlertRecord[]>
  saveCalendarTasks: (tasks: CalendarTask[]) => Promise<void>
  sidebarCollapsed: boolean
  setSidebarCollapsed: (value: boolean) => void
  openIntakeCaseId: string
  clearOpenIntakeCaseId: () => void
}) {
  const metrics: Metric[] = [
    { label: "New alerts", value: alerts.filter((a) => a.internalStatus === "Alert Submitted").length, icon: Inbox, tone: "bg-[#2e6fa3]" },
    { label: "Emergency", value: alerts.filter((a) => a.emergency).length, icon: ShieldAlert, tone: "bg-[#b42318]" },
    { label: "Supervisor review", value: alerts.filter((a) => a.internalStatus === "Pending Supervisor Review").length, icon: ClipboardCheck, tone: "bg-[#7c4d9e]" },
    { label: "Unallocated", value: alerts.filter((a) => a.internalStatus === "Approved for Allocation").length, icon: Users, tone: "bg-[#a05b16]" },
  ]

  if (!user || user.profile.portal !== "internal") {
    return <InternalLogin onLogin={login} onChangePassword={changePassword} onExternal={onExternal} apiError={apiError} />
  }

  return (
    <main className="min-h-screen bg-[#eef2f5] text-[14px] text-[#5f7191]">
      <div className="h-6 bg-[#24384d]" />
      <div className="grid min-h-[calc(100vh-24px)] transition-[grid-template-columns] duration-200" style={{ gridTemplateColumns: sidebarCollapsed ? "72px minmax(0,1fr)" : "235px minmax(0,1fr)" }}>
        <InternalSideNav active={view} setActive={setView} user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
        <div className="min-w-0">
          <InternalTopBar currentView={view} user={user} alerts={alerts} onNotifications={() => setView("notifications")} onLogout={logout} onProfile={() => setView("internal-profile")} />
          <section className="min-w-0 space-y-4 p-4">
            {apiError && <ErrorBanner message={apiError} />}
            {view === "dashboard" && <InternalDashboard user={user} users={users} alerts={alerts} cases={cases} calendarTasks={calendarTasks} setSelectedAlertId={setSelectedAlertId} setSelectedCaseId={setSelectedCaseId} setView={setView} />}
            {view === "notifications" && <Notifications alerts={alerts} onViewAlert={(alert) => { setSelectedAlertId(alert.id); setView("triage") }} />}
            {view === "case-alerts" && <AlertsInbox alerts={alerts} selectedId={selectedAlert.id} setSelectedAlertId={setSelectedAlertId} setView={setView} />}
            {view === "triage" && <Triage alert={selectedAlert} updateAlert={updateAlert} convertAlertToDraftCase={convertAlertToDraftCase} />}
            {view === "case-intake" && <CaseIntakeScreening alert={selectedAlert} alerts={alerts} cases={cases} selectedCase={selectedCase} openCaseId={openIntakeCaseId} onOpenCaseHandled={clearOpenIntakeCaseId} setSelectedAlertId={setSelectedAlertId} setView={setView} saveDraftCase={saveDraftCase} discardDraftCase={discardDraftCase} updateAlert={updateAlert} saveCalendarTasks={saveCalendarTasks} user={user} users={users} districts={districts} wards={wards} organizations={organizations} />}
            {["captured-cases", "new-intake", "intake", "screening"].includes(view) && <CaseIntakeScreening alert={selectedAlert} alerts={alerts} cases={cases} selectedCase={selectedCase} setSelectedAlertId={setSelectedAlertId} setView={setView} saveDraftCase={saveDraftCase} discardDraftCase={discardDraftCase} updateAlert={updateAlert} saveCalendarTasks={saveCalendarTasks} user={user} users={users} districts={districts} wards={wards} organizations={organizations} />}
            {view === "review" && <DistrictHeadCaseQueue mode="submitted" alerts={alerts} cases={cases} users={users} districts={districts} user={user} saveDraftCase={saveDraftCase} updateAlert={updateAlert} saveCalendarTasks={saveCalendarTasks} />}
            {view === "allocation" && <DistrictHeadCaseQueue mode="unallocated" alerts={alerts} cases={cases} users={users} districts={districts} user={user} saveDraftCase={saveDraftCase} updateAlert={updateAlert} saveCalendarTasks={saveCalendarTasks} />}
            {view === "allocated-cases" && <DistrictHeadCaseQueue mode="allocated" alerts={alerts} cases={cases} users={users} districts={districts} user={user} saveDraftCase={saveDraftCase} updateAlert={updateAlert} saveCalendarTasks={saveCalendarTasks} openFullIntake={openFullIntake} />}
            {view === "reports" && <ReportsAnalytics user={user} alerts={alerts} cases={cases} users={users} districts={districts} provinces={provinces} />}
            {view === "update-requests" && <UpdateRequestQueue user={user} />}
            {view === "audit" && <Audit alerts={alerts} />}
            {view === "setup" && <Setup users={users} organizations={organizations} provinces={provinces} districts={districts} wards={wards} refreshUsers={refreshUsers} />}
            {view === "internal-profile" && <InternalProfile user={user} />}
            {["partners", "services", "places", "events", "system", "collaboration"].includes(view) && <LegacyPlaceholder view={view} />}
          </section>
        </div>
      </div>
    </main>
  )
}

function PublicLogin({
  login,
  changePassword,
  apiError,
}: {
  login: (username: string, password: string, loginPortal: "external" | "internal") => Promise<unknown>
  changePassword: (username: string, currentPassword: string, newPassword: string, confirmPassword: string, loginPortal: "external" | "internal") => Promise<unknown>
  apiError: string
}) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [mustChangePassword, setMustChangePassword] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")

  async function submit() {
    try {
      const result = await login(username, password, "external")
      if (isPasswordChangeRequired(result)) setMustChangePassword(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.")
    }
  }

  async function submitPasswordChange() {
    try {
      await changePassword(username, password, newPassword, confirmPassword, "external")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password.")
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#24384d] px-4 py-6">
      <section className="w-full max-w-[520px] rounded-md border border-[#d8dee8] bg-white p-6 shadow-2xl sm:p-7">
        <div className="mb-6 text-center">
          <img className="mx-auto h-16 w-16 object-contain" src={coatOfArms} alt="National coat of arms" />
          <h1 className="mt-3 text-[26px] font-extrabold text-[#10233f]">NCMIS Public Portal</h1>
          <p className="mt-1 text-sm font-semibold text-[#50617a]">{mustChangePassword ? "Set a private password to continue." : "Sign in to raise and track child protection alerts."}</p>
        </div>
        {(error || apiError) && <ErrorBanner message={error || apiError} />}
        <div className="space-y-4">
          {!mustChangePassword ? (
            <>
              <Field label="Email or username"><input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
              <Field label="Password"><input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
              <button className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#008c7a] font-semibold text-white shadow-sm" onClick={submit}>Sign in <ArrowRight className="h-4 w-4" /></button>
            </>
          ) : (
            <>
              <Field label="New password"><input className={inputClass} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" /></Field>
              <Field label="Confirm password"><input className={inputClass} type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" /></Field>
              <button className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#008c7a] font-semibold text-white shadow-sm" onClick={submitPasswordChange}>Change password <ArrowRight className="h-4 w-4" /></button>
            </>
          )}
        </div>
      </section>
    </main>
  )
}

function InternalLogin({
  onLogin,
  onChangePassword,
  onExternal,
  apiError,
}: {
  onLogin: (username: string, password: string, loginPortal: "external" | "internal") => Promise<unknown>
  onChangePassword: (username: string, currentPassword: string, newPassword: string, confirmPassword: string, loginPortal: "external" | "internal") => Promise<unknown>
  onExternal: () => void
  apiError: string
}) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [mustChangePassword, setMustChangePassword] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")

  async function submit() {
    try {
      const result = await onLogin(username, password, "internal")
      if (isPasswordChangeRequired(result)) setMustChangePassword(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.")
    }
  }

  async function submitPasswordChange() {
    try {
      await onChangePassword(username, password, newPassword, confirmPassword, "internal")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password.")
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#24384d] px-4 py-6">
      <section className="w-full max-w-[520px] rounded-md border border-[#d8dee8] bg-white p-6 shadow-2xl sm:p-7">
        <div className="mb-6 text-center">
          <img className="mx-auto h-16 w-16 object-contain" src={coatOfArms} alt="National coat of arms" />
          <h1 className="mt-3 text-[26px] font-extrabold text-[#10233f]">Welcome to NCMIS</h1>
          <p className="mt-1 text-sm font-semibold text-[#50617a]">{mustChangePassword ? "Set a private password to continue." : "Sign in to continue to the staff workspace."}</p>
        </div>
        <div className="space-y-4">
          {(error || apiError) && <ErrorBanner message={error || apiError} />}
          {!mustChangePassword ? (
            <>
              <Field label="Username or email"><input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
              <Field label="Password"><input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
              <button className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#008c7a] font-semibold text-white" onClick={submit}>Sign in <ArrowRight className="h-4 w-4" /></button>
            </>
          ) : (
            <>
              <Field label="New password"><input className={inputClass} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" /></Field>
              <Field label="Confirm password"><input className={inputClass} type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" /></Field>
              <button className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#008c7a] font-semibold text-white" onClick={submitPasswordChange}>Change password <ArrowRight className="h-4 w-4" /></button>
            </>
          )}
        </div>
      </section>
    </main>
  )
}

function Triage({ alert, updateAlert, convertAlertToDraftCase }: { alert: AlertRecord; updateAlert: (id: string, changes: Partial<AlertRecord>) => void; convertAlertToDraftCase: (alert: AlertRecord) => void | Promise<void> }) {
  const [showAlertActions, setShowAlertActions] = useState(false)
  const alertActionsLocked = ["Converted to Case", "Intake In Progress", "Pending Supervisor Review", "Approved for Allocation", "Allocated to Case Officer", "Rejected", "Closed - No Further Action", "Duplicate / Already Known", "Referred to Relevant Office"].includes(alert.status)
  return (
    <Panel title="Alert Details / Triage" icon={ShieldAlert} action={alert.id}>
      <div className={`grid gap-5 ${showAlertActions ? "xl:grid-cols-[minmax(0,1fr)_400px]" : ""}`}>
        <div className="space-y-4">
          <Summary
            alert={alert}
            action={
              <button className="grid h-8 w-8 place-items-center rounded-full border border-[#d8dee8] bg-white text-[#263747] shadow-sm hover:border-[#008c7a] hover:text-[#008c7a]" title="Alert action box" onClick={() => setShowAlertActions((value) => !value)}>
                <InfoIcon className="h-4 w-4" />
              </button>
            }
          />
          <AlertCapturedDetails alert={alert} />
        </div>
        {showAlertActions && (
          <aside className="h-fit rounded-md border border-[#d8dee8] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#edf0f4] px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-[#263747]">Alert Action Box</h3>
                <div className="text-sm font-semibold text-[#64748b]">{alert.id}</div>
              </div>
              <button className="grid h-9 w-9 place-items-center rounded-full border border-[#d8dee8]" onClick={() => setShowAlertActions(false)} title="Close alert action box">
                <InfoIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2 p-5">
              {alertActionsLocked ? (
                <div className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
                  <div className="text-sm font-bold text-[#263747]">Alert actions locked</div>
                  <p className="mt-1 text-sm leading-6 text-[#64748b]">
                    This alert is already {alert.status.toLowerCase()}. Continue the work from Case Intake & Screening.
                  </p>
                  {alert.status === "Converted to Case" && (
                    <button className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={() => convertAlertToDraftCase(alert)}>
                      Open intake/case <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ) : (
                <>
                <ActionButton label="Convert alert to intake/case" onClick={() => convertAlertToDraftCase(alert)} />
                <ActionButton label="Request more information" onClick={() => updateAlert(alert.id, { status: "More Information Requested", internalStatus: "More Information Required" })} />
                <ActionButton label="Mark duplicate" onClick={() => updateAlert(alert.id, { status: "Duplicate / Already Known", internalStatus: "Duplicate Review Required" })} />
                <ActionButton label="Refer externally only" onClick={() => updateAlert(alert.id, { status: "Referred to Relevant Office", internalStatus: "Closed - Referred Externally" })} />
                <ActionButton label="Reject alert" onClick={() => updateAlert(alert.id, { status: "Rejected", internalStatus: "Alert Rejected", emergency: false })} />
                <ActionButton label="Close no further action" onClick={() => updateAlert(alert.id, { status: "Closed - No Further Action", internalStatus: "Closed - No Further Action" })} />
                <ActionButton label="Escalate emergency" onClick={() => updateAlert(alert.id, { status: "Emergency Response Initiated", internalStatus: "Immediate Action Required", emergency: true, riskLevel: "Critical" })} />
                </>
              )}
            </div>
          </aside>
        )}
      </div>
    </Panel>
  )
}

function CapturedCases({ cases, selectedCaseId, setSelectedCaseId, setView }: { cases: CaseRecord[]; selectedCaseId: string; setSelectedCaseId: (id: string) => void; setView: (view: string) => void }) {
  const openCases = cases.length
  const violationCases = cases.filter((caseRecord) => caseRecord.concern.toLowerCase().includes("abuse") || caseRecord.riskLevel === "High").length
  const allocatedCases = cases.filter((caseRecord) => caseRecord.status === "Allocated" || caseRecord.intakeOfficer !== "Intake Officer").length
  const carePlanCases = cases.filter((caseRecord) => caseRecord.status === "Allocated").length

  return (
    <div className="space-y-5 text-[14px]">
      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <LegacyStatCard icon={CheckCircle2} value={openCases} label="Open Cases" tone="bg-[#ff5058]" />
        <LegacyStatCard icon={Inbox} value={violationCases} label="Cases with Violation Details" tone="bg-[#ff5058]" />
        <LegacyStatCard icon={Users} value={allocatedCases} label="Allocated Cases" tone="bg-[#7460bd]" />
        <LegacyStatCard icon={FolderCheck} value={carePlanCases} label="Cases with Care Plan" tone="bg-[#20c455]" />
      </section>

      <Panel title="Captured Cases" icon={BriefcaseBusiness} action={`${cases.length} records`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-[#64748b]">Cases converted from alerts and manual intake drafts.</div>
          <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={() => setView("case-intake")}><Plus className="h-4 w-4" /> New intake</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead className="bg-[#f8fafc] text-[#2e6fa3]">
              <tr>{["Case ID", "Child", "Sex", "Age", "District", "Concern", "Risk", "Status", "Officer", "Created", ""].map((header) => <th key={header} className="border-b border-[#d8dee8] px-3 py-3">{header}</th>)}</tr>
            </thead>
            <tbody>
              {cases.map((caseRecord) => (
                <tr key={caseRecord.id} className={selectedCaseId === caseRecord.id ? "bg-[#e7f6f3]" : "bg-white"}>
                  <td className="border-b border-[#edf0f4] px-3 py-3 font-semibold">{caseRecord.id}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{caseRecord.childName}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{caseRecord.sex}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{caseRecord.age}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{caseRecord.district}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{caseRecord.concern}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{caseRecord.riskLevel}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3"><CaseStatusBadge status={caseRecord.status} /></td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{caseRecord.intakeOfficer || "-"}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{caseRecord.createdAt}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3"><button className="rounded-md bg-[#008c7a] px-3 py-2 text-xs font-semibold text-white" onClick={() => setSelectedCaseId(caseRecord.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

type GuardianDraft = {
  guardian_type: string
  surname: string
  first_names: string
  id_number: string
  dob_or_age: string
  occupation: string
  employer: string
  address: string
  telephone: string
  relationship_to_child: string
  is_primary_caregiver: string
  is_deceased_or_abandoned: string
  notes: string
}

function emptyGuardianDraft(): GuardianDraft {
  return {
    guardian_type: "",
    surname: "",
    first_names: "",
    id_number: "",
    dob_or_age: "",
    occupation: "",
    employer: "",
    address: "",
    telephone: "",
    relationship_to_child: "",
    is_primary_caregiver: "",
    is_deceased_or_abandoned: "",
    notes: "",
  }
}

type DuplicateMatch = {
  case_id: string
  childName: string
  age: string
  district: string
  concern: string
  status: string
  match_score: number
  match_reasons: string[]
}

type ActionPlanItem = {
  service: string
  organisation: string
  responsible: string
  deadline: string
  status: string
  notes: string
}

function CaseIntakeScreening({
  alert,
  alerts,
  cases,
  selectedCase,
  openCaseId = "",
  onOpenCaseHandled,
  setSelectedAlertId,
  setView,
  saveDraftCase,
  discardDraftCase,
  updateAlert,
  saveCalendarTasks,
  user,
  users,
  districts,
  wards,
  organizations,
}: {
  alert: AlertRecord
  alerts: AlertRecord[]
  cases: CaseRecord[]
  selectedCase?: CaseRecord
  openCaseId?: string
  onOpenCaseHandled?: () => void
  setSelectedAlertId: (id: string) => void
  setView: (view: string) => void
  saveDraftCase: (caseRecord: CaseRecord, options?: SaveDraftCaseOptions) => void
  discardDraftCase: (caseRecord: CaseRecord) => void
  updateAlert: (id: string, changes: Partial<AlertRecord>) => void
  saveCalendarTasks: (tasks: CalendarTask[]) => Promise<void>
  user: ApiUser
  users: ApiUser[]
  districts: DistrictOption[]
  wards: WardOption[]
  organizations: OrganizationOption[]
}) {
  const [workspace, setWorkspace] = useState<"list" | "form">("list")
  const lastTabsStorageKey = `ncms:last-intake-tabs:${user.id}`
  const [lastTabs, setLastTabs] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(lastTabsStorageKey) || "{}") as Record<string, string>
    } catch {
      return {}
    }
  })
  const [activeTab, setActiveTab] = useState("summary")
  const [mode, setMode] = useState<"alert" | "manual">("alert")
  const [errors, setErrors] = useState<string[]>([])
  const [savedMessage, setSavedMessage] = useState("")
  const [requestTab, setRequestTab] = useState<IntakeUpdateTab | null>(null)
  const [submissionDialog, setSubmissionDialog] = useState<{ caseId: string; detail: string } | null>(null)
  const [showGuardianModal, setShowGuardianModal] = useState(false)
  const [editingGuardianIndex, setEditingGuardianIndex] = useState<number | null>(null)
  const [clockTick, setClockTick] = useState(Date.now())
  const defaultOfficer = officerDefaults(user)
  const [guardians, setGuardians] = useState<GuardianDraft[]>([])
  const [guardianDraft, setGuardianDraft] = useState<GuardianDraft>(emptyGuardianDraft)
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[]>([])
  const [form, setForm] = useState({
    intake_id: selectedCase?.backendIntakeId || null as number | null,
    alert_id: alert.id,
    case_id: selectedCase?.id || alert.id.replace("ALT", "CASE"),
    intake_number: `INT-${alert.id.replace("ALT-", "")}`,
    intake_source: "",
    status: alert.internalStatus === "Pending Supervisor Review" ? "PENDING_SUPERVISOR_REVIEW" : "INTAKE_IN_PROGRESS",
    alert_received_at: "",
    date_reported: "",
    reporting_channel: "",
    district: "",
    ward: "",
    village: "",
    concern_summary: "",
    reporter_narrative: "",
    emergency_reported: "",
    immediate_danger_reported: "",
    attachments: "",
    officer_user_id: defaultOfficer.officer_user_id,
    officer_surname: defaultOfficer.officer_surname,
    officer_first_names: defaultOfficer.officer_first_names,
    officer_designation: defaultOfficer.officer_designation,
    officer_district: defaultOfficer.officer_district,
    officer_contact: defaultOfficer.officer_contact,
    informant_surname: "",
    informant_first_names: "",
    informant_id_number: "",
    informant_sex: "",
    informant_address: "",
    informant_relationship_to_child: "",
    informant_phone: "",
    informant_email: "",
    informant_organization: "",
    informant_wants_confidentiality: "",
    reporter_type: "",
    child_known: "",
    child_surname: "",
    child_first_names: "",
    child_id_number: "",
    child_sex: "",
    child_date_of_birth: "",
    child_age: "",
    age_is_estimated: "",
    birth_registered: "",
    disability_status: "",
    disability_description: "",
    child_address: "",
    child_contact_details: "",
    home_language: "",
    child_current_location: "",
    child_is_safe_now: "",
    caregiver_present: "",
    selected_categories: [] as string[],
    primary_case_category: "",
    concern_description: "",
    case_category_notes: "",
    alleged_perpetrator_known: "",
    accused_name: "",
    accused_relationship_to_child: "",
    accused_sex: "",
    accused_address: "",
    referred_to_police: "",
    police_reference_number: "",
    police_referral_date: "",
    court_appearance_scheduled: "",
    court_appearance_date: "",
    conviction_determined: "",
    conviction_date: "",
    circumstances_of_offence: "",
    duplicate_status: "NOT_CHECKED",
    duplicate_decision: "",
    linked_case_id: "",
    duplicate_notes: "",
    alert_validity: "",
    immediate_danger: "",
    emergency_required: "",
    risk_level: "",
    system_recommended_risk: "",
    risk_override_reason: "",
    vulnerability_factors: [] as string[],
    safety_concerns: "",
    immediate_intervention_needed: "",
    immediate_response_actions: [] as string[],
    supervisor_notified_at: "",
    supervisor_notified_by: "",
    immediate_action_plan: "",
    screening_notes: "",
    previous_contact_with_dsd: "",
    previous_contact_with_law: "",
    previous_court_orders: "",
    previous_contact_with_other_agencies: "",
    other_background_information: "",
    background_organisation: "",
    background_services: [] as string[],
    other_background_service: "",
    background_service_notes: "",
    prior_assistance: [] as PriorAssistanceDraft[],
    child_story_or_reported_circumstances: "",
    action_plan: "",
    recommended_services: [] as string[],
    other_recommended_service: "",
    action_plan_items: [] as ActionPlanItem[],
    screening_outcome: "",
    referral_partner_id: "",
    closure_reason: "",
    supervisor_id: "",
    submission_comments: "",
    submitted_for_review_at: "",
  })
  const [immediateActionDates, setImmediateActionDates] = useState<Record<string, string>>({})
  const [autosaveState, setAutosaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle")
  const [autosavedAt, setAutosavedAt] = useState("")
  const lastAutosavePayload = useRef("")
  const intakeTopRef = useRef<HTMLDivElement>(null)

  const protectionTypeSections = [
    { title: "Child Abuse", items: ["Sexual abuse", "Physical abuse", "Emotional abuse", "Neglect"] },
    { title: "Worst Forms of Child Labour", items: ["Hazardous labour", "Sexual exploitation", "Child trafficking"] },
    { title: "Alternative Care", items: ["Foster care", "Institutionalized child"] },
    { title: "Children Living Outside of Family Environment", items: ["Child abandonment", "Child being bullied", "Displaced child", "Child living/working on streets", "Child smuggling", "Unaccompanied child"] },
    { title: "Conflict with the Law", items: ["Child in conflict with the law", "Child in contact with the law"] },
    { title: "Child Marriage", items: ["Child married before legal age"] },
    { title: "Disability", items: ["Child with disability"] },
    { title: "HIV", items: ["Child living with HIV"] },
  ]
  const welfareTypeSections = [
    { title: "Welfare Case Types", items: ["Child in need of birth registration/certificates", "Child in need of educational support", "Child in need of transport assistance (service access)", "Child is food insecure", "Child in need of medical support (e.g. in need of AMTO)", "Disabled child in need of devices"] },
  ]
  const courtTypes = ["Ministerial Order", "Criminal Court Order", "Juvenile / Child Court Order", "Defacto Adoption", "Non-defacto Adoption", "Foster Care"]
  const juvenileOffenceSections = [
    { title: "Offence Against a Person", items: ["Assault", "Sexual offence", "Injustice"] },
    { title: "Offences Against Property", items: ["Malicious damage to property", "Theft", "Shoplifting", "Other juvenile property offence"] },
    { title: "Dangerous Drugs Act", items: ["Smoking / sniffing", "Drug trafficking"] },
    { title: "Other", items: ["Forgery, fraud and theft by conversion", "Offence against state and public order", "Wildlife Act"] },
  ]
  const services = ["Medical assistance", "ART", "PEP", "Psycho-social support", "Legal assistance", "VFU services", "Emergency fund", "Cash transfer", "Drought relief", "Birth registration", "Home visit", "BEAM", "Educational assistance", "Transport voucher system", "Case follow ups", "Child Protection", "AMTO", "Case Conferencing / Family Casework", "Court Supervision", "Counselling", "Family Reunification", "Remove from street", "Education Assistance", "Health Assistance", "Financial Assistance", "Birth Registration Assistance", "Psychosocial / Mental Health Assistance", "Disability Assistance", "Bus Warrants", "Referral to Police", "Referral to Health Facility", "Temporary Place of Safety", "Other"]
  const immediateResponseActionSections = [
    { title: "Safety / Protection", items: ["Temporary safety arrangement", "Emergency safety plan", "Shelter placement", "Temporary place of safety", "Remove child from danger", "Home visit / safety check"] },
    { title: "Health", items: ["Medical referral", "Emergency medical treatment", "PEP / ART referral", "Psychosocial first aid", "Counselling referral"] },
    { title: "Police / Legal", items: ["Police referral", "VFU referral", "Court order application", "Preserve evidence / medico-legal report"] },
    { title: "Basic Welfare / Access", items: ["Food assistance", "Transport assistance", "Clothing / hygiene support", "Disability support referral"] },
    { title: "Coordination", items: ["Partner referral", "Family tracing", "Caregiver contacted", "Follow-up visit scheduled", "Other urgent action"] },
  ]
  const immediateResponseActions = immediateResponseActionSections.flatMap((section) => section.items)
  const showJuvenileOffences = form.selected_categories.includes("Juvenile / Child Court Order")
  const serviceDeadlineDays: Record<string, number> = {
    "Remove from street": 1,
    "Temporary Place of Safety": 1,
    "Referral to Police": 1,
    "Referral to Health Facility": 1,
    "Health Assistance": 1,
    "Counselling": 7,
    "Psychosocial / Mental Health Assistance": 7,
    "Case Conferencing / Family Casework": 7,
    "Family Reunification": 14,
    "Education Assistance": 14,
    "Financial Assistance": 14,
    "Birth Registration Assistance": 21,
    "Court Supervision": 30,
    "Disability Assistance": 30,
    "Bus Warrants": 3,
    Other: 7,
  }
  const vulnerabilityFactors = ["child under 5", "sexual abuse alleged", "child currently in danger", "perpetrator has access to child", "disability", "child abandoned", "child living on streets", "trafficking suspected", "severe neglect", "medical emergency", "repeat report"]
  const tabs = [
    ["summary", "Summary"],
    ["officer", "Officer & Informant"],
    ["child", "Child"],
    ["family", "Family"],
    ["case", "Case Type & Prosecution"],
    ["background", "Background"],
    ["plan", "Immediate Needs"],
    ["screening", "Screening & Submit"],
  ]
  const requiresProsecution = form.selected_categories.some((item) => ["Sexual abuse", "Physical abuse", "Sexual exploitation", "Child trafficking", "Child married before legal age", "Child in conflict with the law"].includes(item))
  const screeningClosed = ["PENDING_SUPERVISOR_REVIEW", "APPROVED_FOR_ALLOCATION", "ALLOCATED", "EMERGENCY_ESCALATED"].includes(form.status)
  const sla = screeningClosed
    ? calculateScreeningSla(form.alert_received_at, form.risk_level, form.status === "ALLOCATED" ? "Allocated" : form.status === "APPROVED_FOR_ALLOCATION" ? "Approved for Allocation" : form.status === "PENDING_SUPERVISOR_REVIEW" ? "Pending Supervisor Review" : "Submitted", clockTick, form.submitted_for_review_at || form.alert_received_at)
    : calculateSla(form.alert_received_at, form.risk_level, clockTick)
  const locked = form.status !== "INTAKE_IN_PROGRESS"
  const childUnknown = form.child_known === "No"
  const possibleMatchLabel = `${duplicateMatches.length} possible ${duplicateMatches.length === 1 ? "match" : "matches"} found`
  const supervisorNotified = form.immediate_response_actions.includes("Supervisor notified")
  const convertedFromAlert = mode === "alert" && Boolean(form.alert_id)
  const summaryAlert = convertedFromAlert ? alerts.find((item) => item.id === form.alert_id) || alert : undefined
  const manualDeadlines = workflowDeadlines(form.alert_received_at || form.date_reported || selectedCase?.createdAt || alert.submittedAt, clockTick)
  const tabLabel = (tab: string) => tabs.find(([key]) => key === tab)?.[1] || "Summary"
  const currentCaseRecord = cases.find((caseRecord) => caseRecord.id === form.case_id) || selectedCase
  const canRequestUpdate = currentCaseRecord ? isCaseAllocatedToUser({ ...currentCaseRecord, deadline: "", deadlineStatus: "" }, user) : false

  const intakeRows = cases.filter((caseRecord) => !isEmptyManualPlaceholder(caseRecord))

  useEffect(() => {
    const intervalId = window.setInterval(() => setClockTick(Date.now()), 60000)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    setForm((current) => ({
      ...current,
      officer_user_id: current.officer_user_id || defaultOfficer.officer_user_id,
      officer_surname: current.officer_surname || defaultOfficer.officer_surname,
      officer_first_names: current.officer_first_names || defaultOfficer.officer_first_names,
      officer_designation: current.officer_designation || defaultOfficer.officer_designation,
      officer_district: current.officer_district || defaultOfficer.officer_district,
      officer_contact: current.officer_contact || defaultOfficer.officer_contact,
    }))
  }, [user.id])

  useEffect(() => {
    if (workspace !== "form" || locked) return
    const duplicateFields = [
      form.child_first_names,
      form.child_surname,
      form.child_date_of_birth,
      form.child_age,
      form.child_contact_details,
      form.informant_phone,
      form.district,
      form.ward,
      form.primary_case_category,
      guardians.map((guardian) => `${guardian.first_names} ${guardian.surname} ${guardian.telephone} ${guardian.address}`).join("|"),
      `${guardianDraft.first_names} ${guardianDraft.surname} ${guardianDraft.telephone} ${guardianDraft.address}`,
    ].join("|").trim()
    if (!duplicateFields) return
    const timeoutId = window.setTimeout(() => runDuplicateCheck(false), 350)
    return () => window.clearTimeout(timeoutId)
  }, [
    workspace,
    locked,
    form.child_first_names,
    form.child_surname,
    form.child_date_of_birth,
    form.child_age,
    form.child_contact_details,
    form.informant_phone,
    form.district,
    form.ward,
    form.primary_case_category,
    guardians,
    guardianDraft.first_names,
    guardianDraft.surname,
    guardianDraft.telephone,
    guardianDraft.address,
    cases,
  ])

  useEffect(() => {
    if (workspace !== "form" || locked || !form.intake_id) return
    const payload = JSON.stringify(autosavePayload())
    if (payload === lastAutosavePayload.current) return
    setAutosaveState("dirty")
    const timeoutId = window.setTimeout(() => {
      void autosaveDraft()
    }, 2000)
    return () => window.clearTimeout(timeoutId)
  }, [workspace, locked, form, guardians, guardianDraft])

  useEffect(() => {
    if (workspace !== "form" || locked || !form.intake_id) return
    const intervalId = window.setInterval(() => {
      void autosaveDraft()
    }, 45000)
    return () => window.clearInterval(intervalId)
  }, [workspace, locked, form.intake_id])

  useEffect(() => {
    if (workspace !== "form" || locked || activeTab !== "screening") return
    runDuplicateCheck(false)
    calculateRisk(false)
  }, [
    workspace,
    locked,
    activeTab,
    form.child_first_names,
    form.child_surname,
    form.child_date_of_birth,
    form.child_age,
    form.child_contact_details,
    form.informant_phone,
    form.district,
    form.ward,
    form.primary_case_category,
    form.selected_categories,
    form.vulnerability_factors,
    form.emergency_required,
    form.immediate_danger,
    guardians,
  ])

  function setValue(key: string, value: string | string[]) {
    setForm((current) => {
      if (key === "child_known" && value === "No") {
        return {
          ...current,
          child_known: "No",
          child_surname: "",
          child_first_names: "",
          child_id_number: "",
          child_date_of_birth: "",
          child_contact_details: "",
          child_address: "",
          age_is_estimated: "",
        }
      }
      if (key === "background_organisation" && typeof value === "string") {
        const actionItems = current.action_plan_items.map((item) => ({ ...item, organisation: item.organisation || value }))
        return { ...current, background_organisation: value, action_plan_items: actionItems, action_plan: planSummary(actionItems, current.other_recommended_service) }
      }
      if (key === "district" && typeof value === "string") {
        const districtCode = districtCodeFromName(value, districts)
        const nextCaseId = current.alert_id ? current.case_id : formatCaseNumber(current.case_id, districtCode)
        return { ...current, district: value, case_id: nextCaseId, intake_number: current.alert_id ? current.intake_number : `INT-${nextCaseId.replace("CASE-", "")}` }
      }
      if (key === "other_recommended_service" && typeof value === "string") {
        return { ...current, other_recommended_service: value, action_plan: planSummary(current.action_plan_items, value) }
      }
      if (key === "referred_to_police" && typeof value === "string" && value !== "Yes") {
        return { ...current, referred_to_police: value, police_referral_date: "" }
      }
      if (key === "court_appearance_scheduled" && typeof value === "string" && value !== "Yes") {
        return { ...current, court_appearance_scheduled: value, court_appearance_date: "" }
      }
      if (key === "conviction_determined" && typeof value === "string" && value !== "Yes") {
        return { ...current, conviction_determined: value, conviction_date: "" }
      }
      if (key === "immediate_intervention_needed" && value === "No") {
        setImmediateActionDates({})
        return { ...current, immediate_intervention_needed: "No", immediate_response_actions: [], supervisor_notified_at: "", supervisor_notified_by: "" }
      }
      return { ...current, [key]: value }
    })
    setSavedMessage("")
  }

  function setSupervisorNotified(value: string) {
    setForm((current) => {
      const actions = current.immediate_response_actions.includes("Supervisor notified")
        ? current.immediate_response_actions
        : [...current.immediate_response_actions, "Supervisor notified"]
      if (value === "Yes") {
        const notifier = `${user.first_name} ${user.last_name}`.trim() || user.username
        return {
          ...current,
          immediate_intervention_needed: "Yes",
          immediate_response_actions: actions,
          supervisor_notified_at: current.supervisor_notified_at || new Date().toLocaleString(),
          supervisor_notified_by: current.supervisor_notified_by || notifier,
        }
      }
      return {
        ...current,
        immediate_response_actions: current.immediate_response_actions.filter((action) => action !== "Supervisor notified"),
        supervisor_notified_at: "",
        supervisor_notified_by: "",
      }
    })
    setImmediateActionDates((current) => {
      const { ["Supervisor notified"]: _removed, ...rest } = current
      return rest
    })
    setSavedMessage("")
  }

  function setTab(tab: string) {
    if (!locked) {
      void autosaveDraft("tab")
      runDuplicateCheck(false)
      calculateRisk(false)
    }
    setLastTabs((items) => {
      const next = { ...items, [form.case_id]: tab }
      window.localStorage.setItem(lastTabsStorageKey, JSON.stringify(next))
      return next
    })
    setActiveTab(tab)
    window.requestAnimationFrame(() => {
      intakeTopRef.current?.scrollIntoView({ block: "start" })
      window.scrollTo({ top: 0 })
    })
  }

  async function openCaseIntake(caseRecord: CaseRecord, options: { updateGuidance?: boolean } = {}) {
    const savedIntake = caseRecord.backendIntakeId
      ? await apiGet<IntakeRecord>(`/intakes/${caseRecord.backendIntakeId}/`).catch(() => null)
      : null
    const sourceAlert = caseRecord.sourceAlertId ? alerts.find((item) => item.id === caseRecord.sourceAlertId) || alert : undefined
    const opening = savedIntake?.opening_summary || {}
    const savedInformant = objectValue(opening.informant)
    const savedScreening = objectValue(opening.screening_draft)
    const childDraft = savedIntake?.child_profile_draft || {}
    const householdDraft = savedIntake?.household_profile_draft || {}
    const savedGuardians = Array.isArray(householdDraft.guardians) ? householdDraft.guardians as GuardianDraft[] : []
    const receivedAt = sourceAlert?.submittedAt || caseRecord.createdAt
    const sourceNameParts = (sourceAlert?.information_source_name || "").trim().split(/\s+/)
    const sourceSurname = sourceAlert?.information_source_surname || (sourceNameParts.length > 1 ? sourceNameParts.slice(-1).join(" ") : "")
    const sourceFirstNames = sourceAlert?.information_source_first_names || (sourceNameParts.length > 1 ? sourceNameParts.slice(0, -1).join(" ") : sourceAlert?.information_source_name || "")
    const lifecycleStatus =
      caseRecord.status === "Allocated"
        ? "ALLOCATED"
        : caseRecord.status === "Approved for Allocation"
          ? "APPROVED_FOR_ALLOCATION"
          : caseRecord.status === "Pending Supervisor Review"
            ? "PENDING_SUPERVISOR_REVIEW"
            : caseRecord.status === "Submitted"
              ? "EMERGENCY_ESCALATED"
              : "INTAKE_IN_PROGRESS"
    const submittedAt = textValue(savedScreening.submitted_for_review_at) || caseRecord.submittedForReviewAt || caseRecord.screeningCompletedAt || savedIntake?.screening_completed_at || ""
    if (caseRecord.sourceAlertId) setSelectedAlertId(caseRecord.sourceAlertId)
    const backgroundInformation = savedIntake?.background_information || caseRecord.background_information || {}
    setMode(caseRecord.sourceAlertId ? "alert" : "manual")
    lastAutosavePayload.current = ""
    setAutosaveState(lifecycleStatus === "INTAKE_IN_PROGRESS" ? "saved" : "idle")
    setAutosavedAt("")
    setForm((current) => ({
      ...current,
      intake_id: caseRecord.backendIntakeId || null,
      alert_id: caseRecord.sourceAlertId || "",
      case_id: caseRecord.id,
      intake_number: `INT-${caseRecord.id.replace("CASE-", "")}`,
      intake_source: savedIntake?.intake_source || (caseRecord.sourceAlertId ? "ALERT" : "WALK_IN"),
      status: lifecycleStatus,
      alert_received_at: receivedAt,
      date_reported: textValue(opening.date_reported) || dateInputValue(receivedAt),
      reporting_channel: textValue(opening.reporting_channel) || sourceAlert?.reporting_channel || sourceAlert?.reporterType || current.reporting_channel,
      district: textValue(opening.district) || caseRecord.district,
      ward: textValue(opening.ward) || caseRecord.ward,
      village: textValue(opening.village) || sourceAlert?.village_suburb || "",
      concern_summary: textValue(opening.concern_summary) || caseRecord.concern,
      reporter_narrative: textValue(opening.reporter_narrative) || caseRecord.description,
      emergency_reported: textValue(opening.emergency_reported) || (sourceAlert?.emergency ? "Yes" : "No"),
      immediate_danger_reported: textValue(opening.immediate_danger_reported) || (sourceAlert?.danger.length ? "Yes" : "No"),
      officer_user_id: current.officer_user_id || defaultOfficer.officer_user_id,
      officer_surname: current.officer_surname || defaultOfficer.officer_surname,
      officer_first_names: current.officer_first_names || defaultOfficer.officer_first_names,
      officer_designation: current.officer_designation || defaultOfficer.officer_designation,
      officer_district: current.officer_district || defaultOfficer.officer_district,
      officer_contact: current.officer_contact || defaultOfficer.officer_contact,
      informant_surname: textValue(savedInformant.surname) || sourceSurname,
      informant_first_names: textValue(savedInformant.first_names) || sourceFirstNames,
      informant_id_number: textValue(savedInformant.id_number) || sourceAlert?.information_source_id_number || "",
      informant_sex: textValue(savedInformant.sex) || sourceAlert?.information_source_sex || "",
      informant_address: textValue(savedInformant.address) || sourceAlert?.information_source_address || "",
      informant_relationship_to_child: textValue(savedInformant.relationship_to_child) || sourceAlert?.information_source_relationship_to_child || sourceAlert?.relationship_to_child || "",
      informant_phone: textValue(savedInformant.phone) || sourceAlert?.information_source_contact || sourceAlert?.alternative_contact || "",
      informant_email: textValue(savedInformant.email) || sourceAlert?.information_source_email || "",
      informant_organization: textValue(savedInformant.organization) || sourceAlert?.information_source_type || "",
      informant_wants_confidentiality: textValue(savedInformant.confidentiality) || (sourceAlert?.protect_source_identity ? "Yes" : "No"),
      reporter_type: textValue(savedInformant.reporter_type) || sourceAlert?.information_source_reporter_type || sourceAlert?.reporterType || "",
      child_known: textValue(childDraft.known) || (caseRecord.childName.toLowerCase().includes("unknown") ? "No" : "Yes"),
      child_surname: textValue(childDraft.surname) || sourceAlert?.child_surname || caseRecord.childName.split(" ").slice(-1)[0] || "",
      child_first_names: textValue(childDraft.first_names) || sourceAlert?.child_first_name || caseRecord.childName.split(" ").slice(0, -1).join(" ") || caseRecord.childName,
      child_id_number: textValue(childDraft.id_number),
      child_sex: textValue(childDraft.sex) || (caseRecord.sex.toUpperCase() === "FEMALE" || caseRecord.sex.toUpperCase() === "MALE" ? caseRecord.sex.toUpperCase() : "UNKNOWN"),
      child_date_of_birth: textValue(childDraft.date_of_birth),
      child_age: textValue(childDraft.age) || caseRecord.age,
      age_is_estimated: textValue(childDraft.age_is_estimated),
      birth_registered: textValue(childDraft.birth_registered) || sourceAlert?.birth_registered || "",
      disability_status: textValue(childDraft.disability_status) || sourceAlert?.disability || "",
      disability_description: textValue(childDraft.disability_description),
      child_address: textValue(childDraft.address) || sourceAlert?.home_address || "",
      child_contact_details: textValue(childDraft.contact_details),
      home_language: textValue(childDraft.home_language),
      child_current_location: textValue(childDraft.current_location) || sourceAlert?.current_location || caseRecord.district,
      child_is_safe_now: textValue(childDraft.is_safe_now),
      caregiver_present: textValue(childDraft.caregiver_present) || (sourceAlert?.caregiver_name ? "Yes" : ""),
      selected_categories: arrayValue(savedScreening.selected_categories).length ? arrayValue(savedScreening.selected_categories) : sourceAlert && alertConcerns(sourceAlert).length ? alertConcerns(sourceAlert) : caseRecord.concern ? [caseRecord.concern] : [],
      primary_case_category: savedIntake?.case_category || caseRecord.concern,
      concern_description: textValue(savedScreening.concern_description) || caseRecord.description,
      case_category_notes: textValue(savedScreening.case_category_notes),
      alleged_perpetrator_known: textValue(savedScreening.alleged_perpetrator_known),
      accused_name: textValue(savedScreening.accused_name),
      accused_relationship_to_child: textValue(savedScreening.accused_relationship_to_child),
      accused_sex: textValue(savedScreening.accused_sex),
      accused_address: textValue(savedScreening.accused_address),
      referred_to_police: textValue(savedScreening.referred_to_police),
      police_reference_number: textValue(savedScreening.police_reference_number),
      police_referral_date: textValue(savedScreening.police_referral_date),
      court_appearance_scheduled: textValue(savedScreening.court_appearance_scheduled),
      court_appearance_date: textValue(savedScreening.court_appearance_date),
      conviction_determined: textValue(savedScreening.conviction_determined),
      conviction_date: textValue(savedScreening.conviction_date),
      circumstances_of_offence: textValue(savedScreening.circumstances_of_offence),
      duplicate_status: textValue(savedScreening.duplicate_status) || "NOT_CHECKED",
      duplicate_decision: textValue(savedScreening.duplicate_decision),
      linked_case_id: textValue(savedScreening.linked_case_id),
      duplicate_notes: textValue(savedScreening.duplicate_notes),
      alert_validity: textValue(savedScreening.alert_validity),
      immediate_danger: textValue(savedScreening.immediate_danger),
      emergency_required: textValue(savedScreening.emergency_required),
      risk_level: savedIntake?.risk_level || caseRecord.riskLevel,
      system_recommended_risk: textValue(savedScreening.system_recommended_risk) || savedIntake?.risk_level || caseRecord.riskLevel,
      vulnerability_factors: arrayValue(savedScreening.vulnerability_factors).length ? arrayValue(savedScreening.vulnerability_factors) : sourceAlert?.danger.map((item) => item.toLowerCase()) || [],
      safety_concerns: textValue(savedScreening.safety_concerns),
      immediate_intervention_needed: textValue(savedScreening.immediate_intervention_needed) || (sourceAlert?.emergency ? "Yes" : "No"),
      immediate_response_actions: arrayValue(savedScreening.immediate_response_actions).length ? arrayValue(savedScreening.immediate_response_actions) : sourceAlert?.emergency ? ["Supervisor notified"] : [],
      supervisor_notified_at: textValue(savedScreening.supervisor_notified_at),
      supervisor_notified_by: textValue(savedScreening.supervisor_notified_by),
      immediate_action_plan: savedIntake?.immediate_action_plan || sourceAlert?.actionPlan || "",
      screening_notes: savedIntake?.initial_screening_notes || textValue(savedScreening.screening_notes),
      action_plan: textValue(savedScreening.action_plan) || sourceAlert?.actionPlan || "",
      recommended_services: arrayValue(savedScreening.recommended_services),
      other_recommended_service: textValue(savedScreening.other_recommended_service),
      action_plan_items: Array.isArray(savedScreening.action_plan_items) ? savedScreening.action_plan_items as ActionPlanItem[] : [],
      background_organisation: textValue(savedScreening.background_organisation),
      background_services: arrayValue(savedScreening.background_services),
      other_background_service: textValue(savedScreening.other_background_service),
      background_service_notes: backgroundInformation.background_service_notes || textValue(savedScreening.background_service_notes),
      prior_assistance: savedIntake?.prior_assistance || caseRecord.prior_assistance || [],
      previous_contact_with_dsd: backgroundInformation.previous_contact_with_dsd || "",
      previous_contact_with_law: backgroundInformation.previous_contact_with_law || "",
      previous_court_orders: backgroundInformation.previous_court_orders || "",
      previous_contact_with_other_agencies: backgroundInformation.previous_contact_with_other_agencies || "",
      other_background_information: backgroundInformation.other_background_information || "",
      child_story_or_reported_circumstances: backgroundInformation.child_story_or_reported_circumstances || "",
      screening_outcome: textValue(savedScreening.screening_outcome),
      closure_reason: textValue(savedScreening.closure_reason),
      submission_comments: textValue(savedScreening.submission_comments),
      submitted_for_review_at: submittedAt,
    }))
    setGuardians(savedGuardians)
    setGuardianDraft({ ...emptyGuardianDraft(), ...objectValue(householdDraft.draft_guardian) } as GuardianDraft)
    const restoredTab = lastTabs[caseRecord.id] || "summary"
    setActiveTab(restoredTab)
    setWorkspace("form")
    setErrors([])
    setSavedMessage(lifecycleStatus === "INTAKE_IN_PROGRESS" ? (restoredTab === "summary" ? "" : `Please continue where you left off: ${tabLabel(restoredTab)}.`) : "")
    window.requestAnimationFrame(() => {
      intakeTopRef.current?.scrollIntoView({ block: "start" })
      window.scrollTo({ top: 0 })
    })
  }

  useEffect(() => {
    if (!openCaseId) return
    const targetCase = intakeRows.find((caseRecord) => caseRecord.id === openCaseId)
    if (!targetCase) return
    openCaseIntake(targetCase, { updateGuidance: true })
    onOpenCaseHandled?.()
  }, [openCaseId, cases])

  function openAlertDetails(alertId?: string) {
    if (!alertId) return
    setSelectedAlertId(alertId)
    setView("triage")
  }

  function activeUpdateTab(): IntakeUpdateTab {
    const value = (input: unknown) => {
      if (Array.isArray(input)) return input.length ? input.join(", ") : "Not captured"
      const text = `${input ?? ""}`.trim()
      return text || "Not captured"
    }
    const guardianSummary = guardians.length
      ? guardians.map((item) => [item.guardian_type, item.first_names, item.surname, item.telephone].filter(Boolean).join(" ")).join("; ")
      : "No guardian captured"
    const tabFields: Record<string, [string, string, unknown][]> = {
      summary: [
        ["opening_summary.date_reported", "Date reported", form.date_reported],
        ["opening_summary.reporting_channel", "Reporting channel", form.reporting_channel],
        ["opening_summary.district", "District", form.district],
        ["opening_summary.ward", "Ward", form.ward],
        ["opening_summary.concern_summary", "Concern summary", form.concern_summary],
        ["opening_summary.reporter_narrative", "Reporter narrative", form.reporter_narrative],
      ],
      officer: [
        ["opening_summary.officer.surname", "Officer surname", form.officer_surname],
        ["opening_summary.officer.first_names", "Officer first names", form.officer_first_names],
        ["opening_summary.officer.designation", "Designation", form.officer_designation],
        ["opening_summary.officer.district", "Officer district", form.officer_district],
        ["opening_summary.informant.surname", "Informant surname", form.informant_surname],
        ["opening_summary.informant.first_names", "Informant first names", form.informant_first_names],
        ["opening_summary.informant.phone", "Informant phone", form.informant_phone],
        ["opening_summary.informant.relationship_to_child", "Relationship to child", form.informant_relationship_to_child],
      ],
      child: [
        ["child_profile_draft.known", "Child known", form.child_known],
        ["child_profile_draft.surname", "Surname", form.child_surname],
        ["child_profile_draft.first_names", "First names", form.child_first_names],
        ["child_profile_draft.sex", "Sex", form.child_sex],
        ["child_profile_draft.date_of_birth", "Date of birth", form.child_date_of_birth],
        ["child_profile_draft.age", "Age", form.child_age],
        ["child_profile_draft.current_location", "Current location", form.child_current_location],
        ["child_profile_draft.address", "Address", form.child_address],
      ],
      family: [
        ["household_profile_draft.guardians", "Guardian records", guardianSummary],
        ["household_profile_draft.draft_guardian", "Current guardian draft", [guardianDraft.guardian_type, guardianDraft.first_names, guardianDraft.surname, guardianDraft.telephone].filter(Boolean).join(" ")],
      ],
      case: [
        ["opening_summary.screening_draft.selected_categories", "Case categories", form.selected_categories],
        ["case_category", "Primary case category", form.primary_case_category],
        ["opening_summary.screening_draft.concern_description", "Concern description", form.concern_description],
        ["opening_summary.screening_draft.alleged_perpetrator_known", "Perpetrator known", form.alleged_perpetrator_known],
        ["opening_summary.screening_draft.accused_name", "Accused name", form.accused_name],
        ["opening_summary.screening_draft.referred_to_police", "Referred to police", form.referred_to_police],
      ],
      background: [
        ["background_information.previous_contact_with_dsd", "Previous DSD contact", form.previous_contact_with_dsd],
        ["background_information.previous_contact_with_law", "Previous law contact", form.previous_contact_with_law],
        ["background_information.previous_court_orders", "Previous court orders", form.previous_court_orders],
        ["background_information.other_background_information", "Other background information", form.other_background_information],
        ["background_information.child_story_or_reported_circumstances", "Child story / circumstances", form.child_story_or_reported_circumstances],
      ],
      plan: [
        ["opening_summary.screening_draft.immediate_intervention_needed", "Immediate intervention needed", form.immediate_intervention_needed],
        ["opening_summary.screening_draft.immediate_response_actions", "Immediate response actions", form.immediate_response_actions],
        ["opening_summary.screening_draft.immediate_action_plan", "Immediate action plan", form.immediate_action_plan],
        ["opening_summary.screening_draft.recommended_services", "Recommended services", form.recommended_services],
      ],
      screening: [
        ["risk_level", "Risk level", form.risk_level],
        ["opening_summary.screening_draft.system_recommended_risk", "System recommended risk", form.system_recommended_risk],
        ["opening_summary.screening_draft.vulnerability_factors", "Vulnerability factors", form.vulnerability_factors],
        ["opening_summary.screening_draft.safety_concerns", "Safety concerns", form.safety_concerns],
        ["opening_summary.screening_draft.screening_notes", "Screening notes", form.screening_notes],
      ],
    }
    return {
      key: activeTab,
      label: tabLabel(activeTab),
      fields: (tabFields[activeTab] || tabFields.summary).map(([path, label, current_value]) => ({ path, label, current_value: value(current_value) })),
    }
  }

  function editTabButton() {
    if (!canRequestUpdate) return null
    return (
      <button
        type="button"
        className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d8dee8] bg-white px-3 text-xs font-bold uppercase text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]"
        title="Request update for this tab"
        onClick={() => setRequestTab(activeUpdateTab())}
      >
        <PencilLine className="h-4 w-4" />
        Request Update
      </button>
    )
  }

  function serviceDeadline(service: string) {
    const received = new Date((form.alert_received_at || form.date_reported || "2026-05-18").replace(" ", "T"))
    const days = serviceDeadlineDays[service] ?? 7
    const due = new Date(received.getTime() + days * 24 * 60 * 60 * 1000)
    return due.toISOString().slice(0, 10)
  }

  function immediateDueIsoFromNow() {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  }

  function formatDueDateTime(value: string) {
    return new Date(value).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
  }

  function serviceLabel(service: string, otherService: string) {
    return service === "Other" && otherService.trim() ? `Other: ${otherService.trim()}` : service
  }

  function emptyPriorAssistance(): PriorAssistanceDraft {
    return {
      information_known: "Yes",
      source_type: "",
      partner_id: "",
      partner_name: "",
      district_id: "",
      district_name: "",
      other_district: "",
      services: [],
      other_service: "",
      service_date: "",
      status: "",
      outcome: "",
      notes: "",
    }
  }

  function updatePriorAssistance(index: number, key: keyof PriorAssistanceDraft, value: string | string[]) {
    setForm((current) => {
      const next = current.prior_assistance.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        const updated = { ...item, [key]: value }
        if (key === "source_type") {
          updated.partner_id = ""
          updated.partner_name = ""
          updated.district_id = ""
          updated.district_name = ""
          updated.other_district = ""
        }
        if (key === "partner_id" && typeof value === "string") {
          updated.partner_name = organizations.find((organisation) => `${organisation.id}` === value)?.name || ""
        }
        if (key === "district_id" && typeof value === "string") {
          updated.district_name = value === "OTHER" ? "" : districts.find((district) => `${district.id}` === value)?.name || ""
        }
        return updated
      })
      return { ...current, prior_assistance: next }
    })
    setSavedMessage("")
  }

  function togglePriorAssistanceService(index: number, service: string) {
    setForm((current) => {
      const next = current.prior_assistance.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        const services = item.services.includes(service) ? item.services.filter((value) => value !== service) : [...item.services, service]
        return { ...item, services, other_service: services.includes("Other") ? item.other_service : "" }
      })
      return { ...current, prior_assistance: next }
    })
    setSavedMessage("")
  }

  function addPriorAssistance() {
    const nextRecordNumber = form.prior_assistance.length + 1
    setForm((current) => ({ ...current, prior_assistance: [emptyPriorAssistance(), ...current.prior_assistance] }))
    setSavedMessage(`Please fill the fields for record ${nextRecordNumber}.`)
  }

  function removePriorAssistance(index: number) {
    setForm((current) => ({ ...current, prior_assistance: current.prior_assistance.filter((_, itemIndex) => itemIndex !== index) }))
    setSavedMessage("")
  }

  function priorAssistanceName(item: PriorAssistanceDraft) {
    if (item.source_type === "PARTNER") return item.partner_name || "Partner not selected"
    if (item.source_type === "DISTRICT") return item.other_district || item.district_name || "District not selected"
    return "Source not selected"
  }

  function manualDraftHasCapturedData() {
    return hasManualMinimumIntakeData(autosavePayload().opening_summary, autosavePayload().child_profile_draft)
  }

  async function backToIntakeList() {
    if (mode === "manual" && form.intake_id && !manualDraftHasCapturedData()) {
      try {
        await apiDelete(`/intakes/${form.intake_id}/`)
      } catch (error) {
        setErrors([error instanceof Error ? error.message : "Could not discard the empty manual intake draft."])
        return
      }
      discardDraftCase(caseRecord("Draft"))
      setSelectedAlertId(alerts[0]?.id || "")
      setSavedMessage("")
    } else if (mode === "manual" && form.intake_id) {
      await autosaveDraft("manual")
      saveDraftCase(caseRecord("Draft"))
    }
    setWorkspace("list")
  }

  function planSummary(items: ActionPlanItem[], otherService: string) {
    return items.map((item) => `${serviceLabel(item.service, otherService)} - ${item.organisation || "Organisation to confirm"} - due ${item.deadline}`).join("\n")
  }

  function autosavePayload() {
    return {
      intake_source: form.intake_source || (mode === "alert" ? "ALERT" : "WALK_IN"),
      opening_summary: {
        alert_id: form.alert_id,
        case_id: form.case_id,
        intake_number: form.intake_number,
        date_reported: form.date_reported,
        reporting_channel: form.reporting_channel,
        district: form.district,
        ward: form.ward,
        village: form.village,
        concern_summary: form.concern_summary,
        reporter_narrative: form.reporter_narrative,
        emergency_reported: form.emergency_reported,
        immediate_danger_reported: form.immediate_danger_reported,
        attachments: form.attachments,
        officer_user_id: form.officer_user_id,
        officer_surname: form.officer_surname,
        officer_first_names: form.officer_first_names,
        officer_designation: form.officer_designation,
        officer_district: form.officer_district,
        officer_contact: form.officer_contact,
        informant: {
          surname: form.informant_surname,
          first_names: form.informant_first_names,
          id_number: form.informant_id_number,
          sex: form.informant_sex,
          address: form.informant_address,
          relationship_to_child: form.informant_relationship_to_child,
          phone: form.informant_phone,
          email: form.informant_email,
          organization: form.informant_organization,
          confidentiality: form.informant_wants_confidentiality,
          reporter_type: form.reporter_type,
        },
        screening_draft: {
          selected_categories: form.selected_categories,
          concern_description: form.concern_description,
          case_category_notes: form.case_category_notes,
          alleged_perpetrator_known: form.alleged_perpetrator_known,
          accused_name: form.accused_name,
          accused_relationship_to_child: form.accused_relationship_to_child,
          accused_sex: form.accused_sex,
          accused_address: form.accused_address,
          referred_to_police: form.referred_to_police,
          police_reference_number: form.police_reference_number,
          police_referral_date: form.police_referral_date,
          court_appearance_scheduled: form.court_appearance_scheduled,
          court_appearance_date: form.court_appearance_date,
          conviction_determined: form.conviction_determined,
          conviction_date: form.conviction_date,
          circumstances_of_offence: form.circumstances_of_offence,
          duplicate_status: form.duplicate_status,
          duplicate_decision: form.duplicate_decision,
          linked_case_id: form.linked_case_id,
          duplicate_notes: form.duplicate_notes,
          alert_validity: form.alert_validity,
          immediate_danger: form.immediate_danger,
          emergency_required: form.emergency_required,
          system_recommended_risk: form.system_recommended_risk,
          vulnerability_factors: form.vulnerability_factors,
          safety_concerns: form.safety_concerns,
          immediate_intervention_needed: form.immediate_intervention_needed,
          immediate_response_actions: form.immediate_response_actions,
          supervisor_notified_at: form.supervisor_notified_at,
          supervisor_notified_by: form.supervisor_notified_by,
          screening_notes: form.screening_notes,
          background_organisation: form.background_organisation,
          background_services: form.background_services,
          other_background_service: form.other_background_service,
          recommended_services: form.recommended_services,
          other_recommended_service: form.other_recommended_service,
          action_plan_items: form.action_plan_items,
          action_plan: form.action_plan,
          screening_outcome: form.screening_outcome,
          closure_reason: form.closure_reason,
          submission_comments: form.submission_comments,
          submitted_for_review_at: form.submitted_for_review_at,
        },
      },
      child_profile_draft: {
        known: form.child_known,
        surname: form.child_surname,
        first_names: form.child_first_names,
        id_number: form.child_id_number,
        sex: form.child_sex,
        date_of_birth: form.child_date_of_birth,
        age: form.child_age,
        age_is_estimated: form.age_is_estimated,
        birth_registered: form.birth_registered,
        disability_status: form.disability_status,
        disability_description: form.disability_description,
        address: form.child_address,
        contact_details: form.child_contact_details,
        home_language: form.home_language,
        current_location: form.child_current_location,
        is_safe_now: form.child_is_safe_now,
        caregiver_present: form.caregiver_present,
      },
      household_profile_draft: {
        guardians,
        draft_guardian: guardianDraft,
      },
      background_information: {
        previous_contact_with_dsd: form.previous_contact_with_dsd,
        previous_contact_with_law: form.previous_contact_with_law,
        previous_court_orders: form.previous_court_orders,
        previous_contact_with_other_agencies: form.previous_contact_with_other_agencies,
        other_background_information: form.other_background_information,
        child_story_or_reported_circumstances: form.child_story_or_reported_circumstances,
        background_service_notes: form.background_service_notes,
      },
      prior_assistance: form.prior_assistance,
      initial_screening_notes: form.screening_notes,
      case_category: form.primary_case_category || form.selected_categories[0] || "",
      risk_level: form.risk_level || "Pending",
      immediate_action_required: form.immediate_intervention_needed === "Yes" || form.emergency_required === "Yes",
      immediate_action_plan: form.immediate_action_plan || form.action_plan,
    }
  }

  async function autosaveDraft(reason = "auto") {
    if (workspace !== "form" || locked || !form.intake_id) return
    const payload = autosavePayload()
    const signature = JSON.stringify(payload)
    if (signature === lastAutosavePayload.current) return
    setAutosaveState("saving")
    try {
      await apiPatch(`/intakes/${form.intake_id}/`, payload)
      lastAutosavePayload.current = signature
      saveDraftCase(caseRecord("Draft"))
      const savedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      setAutosavedAt(savedAt)
      setAutosaveState("saved")
      if (reason !== "auto") setSavedMessage(`Draft saved at ${savedAt}.`)
    } catch (error) {
      setAutosaveState("error")
      setErrors([error instanceof Error ? error.message : "Autosave failed."])
    }
  }

  function toggleArray(key: "selected_categories" | "vulnerability_factors" | "recommended_services" | "background_services" | "immediate_response_actions", item: string) {
    setForm((current) => {
      const values = current[key]
      const next = values.includes(item) ? values.filter((value) => value !== item) : [...values, item]
      if (key === "recommended_services") {
        const actionItems = values.includes(item)
          ? current.action_plan_items.filter((planItem) => planItem.service !== item)
          : [
              ...current.action_plan_items,
              {
                service: item,
                organisation: current.background_organisation || "",
                responsible: current.officer_first_names || "Case officer",
                deadline: serviceDeadline(item),
                status: "Planned",
                notes: "",
              },
            ]
        return { ...current, recommended_services: next, action_plan_items: actionItems, action_plan: planSummary(actionItems, current.other_recommended_service) }
      }
      if (key === "immediate_response_actions") {
        if (values.includes(item)) {
          setImmediateActionDates((currentDates) => {
            const { [item]: _removed, ...rest } = currentDates
            return rest
          })
        }
      }
      return { ...current, [key]: next, primary_case_category: key === "selected_categories" && !current.primary_case_category ? item : current.primary_case_category }
    })
  }

  function updateActionPlanItem(index: number, field: keyof ActionPlanItem, value: string) {
    setForm((current) => {
      const actionItems = current.action_plan_items.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item))
      return { ...current, action_plan_items: actionItems, action_plan: planSummary(actionItems, current.other_recommended_service) }
    })
  }

  function openAddGuardianModal() {
    setEditingGuardianIndex(null)
    setGuardianDraft(emptyGuardianDraft())
    setShowGuardianModal(true)
  }

  function openEditGuardianModal(index: number) {
    if (locked) return
    setEditingGuardianIndex(index)
    setGuardianDraft({ ...guardians[index] })
    setShowGuardianModal(true)
  }

  function closeGuardianModal() {
    setShowGuardianModal(false)
    setEditingGuardianIndex(null)
    setGuardianDraft(emptyGuardianDraft())
  }

  function deleteGuardian(index: number) {
    setGuardians((items) => items.filter((_, itemIndex) => itemIndex !== index))
    if (editingGuardianIndex === index) closeGuardianModal()
  }

  function saveGuardian() {
    const missing = !guardianDraft.surname || !guardianDraft.first_names || !guardianDraft.address || !guardianDraft.telephone
    if (missing) {
      setErrors(["Guardian surname, first names, address, and telephone are required."])
      return
    }
    setGuardians((items) => {
      if (editingGuardianIndex === null) return [...items, guardianDraft]
      return items.map((item, itemIndex) => (itemIndex === editingGuardianIndex ? guardianDraft : item))
    })
    closeGuardianModal()
    setErrors([])
  }

  function runDuplicateCheck(showMessage = true) {
    const normalize = (value: unknown) => `${value || ""}`.trim().toLowerCase()
    const childName = normalize(`${form.child_first_names} ${form.child_surname}`)
    const guardianNames = guardians
      .map((guardian) => normalize(`${guardian.first_names} ${guardian.surname}`))
      .filter(Boolean)
    const guardianPhones = guardians.map((guardian) => normalize(guardian.telephone)).filter(Boolean)
    const openGuardianName = normalize(`${guardianDraft.first_names} ${guardianDraft.surname}`)
    const openGuardianPhone = normalize(guardianDraft.telephone)
    if (openGuardianName) guardianNames.push(openGuardianName)
    if (openGuardianPhone) guardianPhones.push(openGuardianPhone)
    const phoneValues = [form.child_contact_details, form.informant_phone, ...guardianPhones].map(normalize).filter(Boolean)

    const matches = cases
      .filter((item) => item.id !== form.case_id)
      .map((item) => {
        let score = 0
        const reasons: string[] = []
        const record = item as CaseRecord & Record<string, unknown>
        const recordChildName = normalize(item.childName)
        const recordGuardianName = normalize(record.guardianName || record.guardian_name || record.primaryGuardian || record.primary_guardian)
        const recordPhone = normalize(record.phone || record.telephone || record.guardianPhone || record.guardian_phone || record.childContactDetails || record.child_contact_details)
        const recordDob = normalize(record.dateOfBirth || record.date_of_birth || record.childDateOfBirth || record.child_date_of_birth)
        if (childName && recordChildName === childName) {
          score += 40
          reasons.push("same child name")
        } else if (childName && recordChildName.includes(childName)) {
          score += 25
          reasons.push("similar child name")
        }
        if (recordDob && form.child_date_of_birth && recordDob === normalize(form.child_date_of_birth)) {
          score += 25
          reasons.push("same date of birth")
        }
        if (item.age && item.age === form.child_age) {
          score += 15
          reasons.push("same age")
        }
        if (phoneValues.length && recordPhone && phoneValues.includes(recordPhone)) {
          score += 25
          reasons.push("same phone")
        }
        if (guardianNames.length && recordGuardianName && guardianNames.includes(recordGuardianName)) {
          score += 25
          reasons.push("same guardian")
        }
        if (item.district === form.district) {
          score += 15
          reasons.push("same district")
        }
        if (item.ward === form.ward) {
          score += 10
          reasons.push("same ward")
        }
        if (form.selected_categories.includes(item.concern) || item.concern === form.primary_case_category) {
          score += 20
          reasons.push("same case category")
        }
        return { case_id: item.id, childName: item.childName, age: item.age, district: item.district, concern: item.concern, status: item.status, match_score: score, match_reasons: reasons }
      })
      .filter((item) => item.match_score >= 35)
      .sort((a, b) => b.match_score - a.match_score)
    setDuplicateMatches(matches)
    setForm((current) => ({ ...current, duplicate_status: matches.length ? "POSSIBLE_DUPLICATE" : "NO_DUPLICATE_FOUND" }))
    if (showMessage) setSavedMessage(matches.length ? "Possible duplicate found. Choose a duplicate decision before submission." : "Duplicate check complete. No likely duplicate found.")
  }

  function calculateRisk(showMessage = true) {
    const factors = form.vulnerability_factors.map((item) => item.toLowerCase())
    const categories = form.selected_categories.map((item) => item.toLowerCase())
    let risk = "LOW"
    if (form.emergency_required === "Yes" || form.immediate_danger === "Yes" || (factors.includes("sexual abuse alleged") && factors.includes("perpetrator has access to child"))) risk = "CRITICAL"
    else if (categories.includes("sexual abuse") || factors.includes("trafficking suspected") || factors.includes("child abandoned") || factors.includes("child living on streets")) risk = "HIGH"
    else if (categories.some((item) => ["neglect", "educational support", "food insecurity", "medical support / amto"].includes(item))) risk = "MEDIUM"
    setForm((current) => ({ ...current, system_recommended_risk: risk, risk_level: risk }))
    if (showMessage) setSavedMessage(`Risk calculated as ${risk}.`)
  }

  function validateForSubmit() {
    const nextErrors: string[] = []
    if (!form.district) nextErrors.push("District is required.")
    if (!form.child_current_location) nextErrors.push("Child current location is required.")
    if (!form.child_sex) nextErrors.push("Child sex must be selected, or UNKNOWN.")
    if (!form.child_date_of_birth && !form.child_age) nextErrors.push("Child age or date of birth is required.")
    if (!form.selected_categories.length) nextErrors.push("Select at least one case type.")
    if (!form.primary_case_category) nextErrors.push("Primary case category is required.")
    if (requiresProsecution && !form.alleged_perpetrator_known) nextErrors.push("Perpetrator known is required for the selected case category.")
    if (requiresProsecution && form.alleged_perpetrator_known === "Yes" && !form.accused_name.trim()) nextErrors.push("Accused name is required when perpetrator known is Yes.")
    if (duplicateMatches.length && !form.duplicate_decision) nextErrors.push("Possible duplicate exists. Choose a duplicate decision.")
    if (["LINK_TO_EXISTING_CASE", "MERGE_WITH_EXISTING_CASE"].includes(form.duplicate_decision) && !form.linked_case_id) nextErrors.push("Linked case ID is required for link or merge decisions.")
    if (form.referred_to_police === "Yes" && !form.police_referral_date) nextErrors.push("Police referral date is required.")
    if (form.court_appearance_scheduled === "Yes" && !form.court_appearance_date) nextErrors.push("Court appearance date is required.")
    if (form.conviction_determined === "Yes" && !form.conviction_date) nextErrors.push("Conviction date is required.")
    if (form.immediate_intervention_needed === "Yes" && !form.immediate_response_actions.length) nextErrors.push("Select at least one immediate response action.")
    if (["HIGH", "CRITICAL"].includes(form.risk_level.toUpperCase()) && !form.immediate_action_plan) nextErrors.push("Immediate notes are required for high or critical risk.")
    if (form.background_services.includes("Other") && !form.other_background_service.trim()) nextErrors.push("Specify the other background service.")
    form.prior_assistance.forEach((item, index) => {
      const row = index + 1
      if (!item.information_known) nextErrors.push(`Prior assistance ${row}: select whether information is known.`)
      if (item.information_known === "Yes") {
        if (!item.source_type) nextErrors.push(`Prior assistance ${row}: select partner or district.`)
        if (item.source_type === "PARTNER" && !item.partner_id) nextErrors.push(`Prior assistance ${row}: select a partner.`)
        if (item.source_type === "DISTRICT" && !item.district_id) nextErrors.push(`Prior assistance ${row}: select a district.`)
        if (item.district_id === "OTHER" && !item.other_district.trim()) nextErrors.push(`Prior assistance ${row}: enter the other district name.`)
        if (!item.services.length) nextErrors.push(`Prior assistance ${row}: select at least one service.`)
        if (item.services.includes("Other") && !item.other_service.trim()) nextErrors.push(`Prior assistance ${row}: specify the other service.`)
      }
    })
    if (form.emergency_required === "Yes" && !supervisorNotified) nextErrors.push("Emergency cases require supervisor notification under Immediate Needs.")
    return nextErrors
  }

  function caseRecord(status: CaseRecord["status"]): CaseRecord {
    const name = form.child_known === "No" ? "Unknown child" : `${form.child_first_names} ${form.child_surname}`.trim() || "Unknown child"
    const payload = autosavePayload()
    return {
      id: form.case_id,
      backendIntakeId: form.intake_id || undefined,
      sourceAlertId: mode === "alert" ? form.alert_id : undefined,
      intakeDraft: {
        ...payload,
        id: form.intake_id || selectedCase?.backendIntakeId || 0,
        alert: null,
        alertReference: mode === "alert" ? form.alert_id : null,
        temporary_case_reference: form.case_id,
        screening_completed_at: status === "Pending Supervisor Review" ? form.submitted_for_review_at || new Date().toISOString() : selectedCase?.screeningCompletedAt || null,
        status,
        created_at: form.alert_received_at || selectedCase?.createdAt || new Date().toISOString(),
      },
      childName: name,
      sex: form.child_sex,
      age: form.child_age || "Unknown",
      district: form.district,
      ward: form.ward,
      concern: form.primary_case_category || form.selected_categories[0] || "Uncategorized",
      riskLevel: form.risk_level,
      status,
      intakeOfficer: `${form.officer_first_names} ${form.officer_surname}`.trim(),
      createdAt: form.alert_received_at || selectedCase?.createdAt || new Date().toISOString(),
      screeningCompletedAt: status === "Pending Supervisor Review" ? form.submitted_for_review_at || new Date().toISOString() : selectedCase?.screeningCompletedAt,
      submittedForReviewAt: status === "Pending Supervisor Review" ? form.submitted_for_review_at || new Date().toISOString() : selectedCase?.submittedForReviewAt,
      description: form.concern_description || form.reporter_narrative,
      background_information: {
        previous_contact_with_dsd: form.previous_contact_with_dsd,
        previous_contact_with_law: form.previous_contact_with_law,
        previous_court_orders: form.previous_court_orders,
        previous_contact_with_other_agencies: form.previous_contact_with_other_agencies,
        other_background_information: form.other_background_information,
        child_story_or_reported_circumstances: form.child_story_or_reported_circumstances,
        background_service_notes: form.background_service_notes,
      },
      prior_assistance: form.prior_assistance,
      manualMinimumComplete: mode !== "manual" || manualDraftHasCapturedData(),
    }
  }

  function saveDraft() {
    void autosaveDraft("manual")
    saveDraftCase(caseRecord("Draft"))
    if (mode === "alert") updateAlert(alert.id, { status: "Intake In Progress", internalStatus: "Intake In Progress", intakeOfficer: `${form.officer_first_names} ${form.officer_surname}`.trim(), riskLevel: form.risk_level, caseCategory: form.primary_case_category })
    setSavedMessage("Draft saved.")
    setErrors([])
  }

  async function submitToSupervisor() {
    if (locked) return
    runDuplicateCheck(false)
    calculateRisk(false)
    const nextErrors = validateForSubmit()
    if (nextErrors.length) {
      setErrors(nextErrors)
      return
    }
    const immediateActionTasks = buildImmediateActionTasks()
    if (immediateActionTasks.length) {
      try {
        await saveCalendarTasks(immediateActionTasks)
      } catch (err) {
        setErrors([err instanceof Error ? err.message : "Could not save immediate action dates to the calendar."])
        return
      }
    }
    const submittedAt = new Date().toISOString()
    const submittedPayload = {
      ...autosavePayload(),
      opening_summary: {
        ...autosavePayload().opening_summary,
        screening_draft: {
          ...autosavePayload().opening_summary.screening_draft,
          screening_outcome: "SUBMIT_TO_SUPERVISOR",
          submitted_for_review_at: submittedAt,
        },
      },
      status: "Pending Supervisor Review",
      screening_completed_at: submittedAt,
    }
    if (form.intake_id) {
      try {
        await apiPatch(`/intakes/${form.intake_id}/`, submittedPayload)
        lastAutosavePayload.current = JSON.stringify(submittedPayload)
      } catch (error) {
        setErrors([error instanceof Error ? error.message : "Could not save submission time."])
        return
      }
    }
    setForm((current) => ({ ...current, status: "PENDING_SUPERVISOR_REVIEW", screening_outcome: "SUBMIT_TO_SUPERVISOR", submitted_for_review_at: submittedAt }))
    saveDraftCase({ ...caseRecord("Pending Supervisor Review"), submittedForReviewAt: submittedAt })
    if (mode === "alert") updateAlert(alert.id, { status: "Pending Supervisor Review", internalStatus: "Pending Supervisor Review", intakeOfficer: `${form.officer_first_names} ${form.officer_surname}`.trim(), riskLevel: form.risk_level, caseCategory: form.primary_case_category, actionPlan: form.immediate_action_plan || form.action_plan })
    setErrors([])
    const detail = immediateActionTasks.length
      ? `Case ${form.case_id} has been submitted successfully for supervisor review. Immediate action dates were saved to the calendar.`
      : `Case ${form.case_id} has been submitted successfully for supervisor review.`
    setSavedMessage("Submitted to supervisor. Intake fields are now locked for normal editing.")
    setSubmissionDialog({ caseId: form.case_id, detail })
  }

  function escalateEmergency() {
    if (!form.immediate_action_plan) {
      setErrors(["Immediate action plan is required before emergency escalation."])
      return
    }
    saveDraftCase(caseRecord("Submitted"))
    setForm((current) => ({ ...current, status: "EMERGENCY_ESCALATED", risk_level: "CRITICAL", system_recommended_risk: "CRITICAL" }))
    if (mode === "alert") updateAlert(alert.id, { status: "Emergency Escalated", internalStatus: "Emergency Escalated", emergency: true, riskLevel: "Critical", actionPlan: form.immediate_action_plan })
    setErrors([])
    setSavedMessage("Emergency escalation recorded and visually marked as critical.")
  }

  function closeInvalid() {
    if (locked) return
    setValue("screening_outcome", "CLOSE_INVALID")
    if (!form.closure_reason.trim()) {
      setErrors(["Enter a closure reason before closing this intake as invalid."])
      return
    }
    saveDraftCase(caseRecord("Draft"))
    setErrors([])
    setSavedMessage("Outcome set to close invalid. Draft saved for supervisor/audit review.")
  }

  function buildImmediateActionTasks(): CalendarTask[] {
    return form.immediate_response_actions
      .filter((action) => action !== "Supervisor notified")
      .map((action) => ({ action, due: immediateDueIsoFromNow() }))
      .map((item) => ({
        id: `${form.case_id || form.alert_id || "intake"}-${item.action}`,
        title: item.action,
        detail: `${form.case_id || form.alert_id || "Case intake"} - due ${formatDueDateTime(item.due)}`,
        date: item.due.slice(0, 10),
        urgent: form.risk_level.toUpperCase() === "CRITICAL" || form.emergency_required === "Yes",
        source: form.case_id || form.alert_id || "intake",
      }))
  }

  async function startManualIntake() {
    setMode("manual")
    let intake: IntakeRecord | null = null
    try {
      intake = await apiPost<IntakeRecord>("/intakes/", {
        intake_source: "WALK_IN",
        opening_summary: {
          source: "Manual intake",
          started_at: new Date().toISOString(),
        },
      })
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Could not start manual intake draft."])
      return
    }
    const manualCaseId = intake ? displayCaseId(intake) : `CASE-DRAFT-${`${cases.length + 1}`.padStart(3, "0")}`
    const createdAt = intake?.created_at || new Date().toLocaleString()
    setForm((current) => ({
      ...current,
      intake_id: intake?.id || null,
      alert_id: "",
      case_id: manualCaseId,
      intake_number: `INT-${manualCaseId.replace("CASE-", "")}`,
      intake_source: "WALK_IN",
      alert_received_at: createdAt,
      date_reported: dateInputValue(createdAt),
      reporting_channel: "",
      district: "",
      ward: "",
      concern_summary: "",
      reporter_narrative: "",
      emergency_reported: "",
      immediate_danger_reported: "",
      officer_user_id: defaultOfficer.officer_user_id,
      officer_surname: defaultOfficer.officer_surname,
      officer_first_names: defaultOfficer.officer_first_names,
      officer_designation: defaultOfficer.officer_designation,
      officer_district: defaultOfficer.officer_district,
      officer_contact: defaultOfficer.officer_contact,
      child_known: "",
      child_surname: "",
      child_first_names: "",
      child_age: "",
      child_current_location: "",
      selected_categories: [],
      primary_case_category: "",
      concern_description: "",
      risk_level: "",
      system_recommended_risk: "",
      immediate_intervention_needed: "",
      immediate_response_actions: [],
      supervisor_notified_at: "",
      supervisor_notified_by: "",
      immediate_action_plan: "",
      action_plan: "",
      recommended_services: [],
      other_recommended_service: "",
      action_plan_items: [],
      background_organisation: "",
      background_services: [],
      other_background_service: "",
      background_service_notes: "",
      prior_assistance: [],
      previous_contact_with_dsd: "",
      previous_contact_with_law: "",
      previous_court_orders: "",
      previous_contact_with_other_agencies: "",
      other_background_information: "",
      child_story_or_reported_circumstances: "",
    }))
    setActiveTab("summary")
    setWorkspace("form")
    setErrors([])
    setSavedMessage("Manual intake started.")
    setAutosaveState("saved")
    setAutosavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
    lastAutosavePayload.current = ""
  }

  if (workspace === "list") {
    return (
      <Panel title="Case Intake & Screening" icon={FileText} action={`${intakeRows.length} intakes`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-[#64748b]">Open a draft to continue capturing, or review submitted and escalated intakes in read-only mode.</div>
          </div>
          <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={startManualIntake}><Plus className="h-4 w-4" /> Manual intake</button>
        </div>
        <div className="overflow-x-auto rounded-md border border-[#d8dee8] bg-white">
          <table className="w-full min-w-[1050px] border-collapse text-left text-sm">
            <thead className="bg-[#f8fafc] text-[#2e6fa3]">
              <tr>{["Case ID", "Alert ID", "Child", "District", "Ward", "Primary concern", "Risk", "Screening SLA", "Status", "Officer", "Open"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr>
            </thead>
            <tbody>
              {intakeRows.map((caseRecord) => {
                const screeningSla = calculateScreeningSla(alerts.find((item) => item.id === caseRecord.sourceAlertId)?.submittedAt || caseRecord.createdAt, caseRecord.riskLevel, caseRecord.status, clockTick, caseRecord.submittedForReviewAt)
                return (
                <tr key={caseRecord.id} className="bg-white hover:bg-[#f8fafc]">
                  <td className="border-b border-[#edf0f4] px-3 py-3">
                    <button className="font-bold text-[#30528c] underline-offset-2 hover:text-[#008c7a] hover:underline" onClick={() => openCaseIntake(caseRecord)}>{caseRecord.id}</button>
                  </td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">
                    {caseRecord.sourceAlertId ? (
                      <button className="font-semibold text-[#30528c] underline-offset-2 hover:text-[#008c7a] hover:underline" onClick={() => openAlertDetails(caseRecord.sourceAlertId)}>
                        {caseRecord.sourceAlertId}
                      </button>
                    ) : "Manual"}
                  </td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{caseRecord.childName}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{caseRecord.district}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{caseRecord.ward}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{caseRecord.concern}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{caseRecord.riskLevel}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3"><SlaBadge sla={screeningSla} /></td>
                  <td className="border-b border-[#edf0f4] px-3 py-3"><CaseStatusBadge status={caseRecord.status} /></td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{caseRecord.intakeOfficer || "-"}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">
                    <button className="inline-flex h-9 items-center gap-2 rounded-md bg-[#008c7a] px-3 text-xs font-semibold text-white" onClick={() => openCaseIntake(caseRecord)}><Eye className="h-4 w-4" /> Open</button>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      </Panel>
    )
  }

  return (
    <div ref={intakeTopRef} className="space-y-4">
      <div className="sticky top-0 z-10 rounded-md border border-[#d8dee8] bg-white/95 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-bold text-[#263747]">Case Intake & Screening</h1>
              <StatusPill label={form.status.replace(/_/g, " ")} tone={form.status === "EMERGENCY_ESCALATED" ? "danger" : ["PENDING_SUPERVISOR_REVIEW", "APPROVED_FOR_ALLOCATION", "ALLOCATED"].includes(form.status) ? "review" : "draft"} />
              {duplicateMatches.length > 0 && <StatusPill label="Duplicate Possible" tone="warning" />}
              {!screeningClosed && sla.status !== "ON TIME" && <StatusPill label={sla.status} tone={sla.status === "DUE SOON" ? "warning" : "danger"} />}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-sm text-[#64748b]">
              <span>{form.case_id} |</span>
              {form.alert_id ? <button className="font-semibold text-[#30528c] hover:text-[#008c7a] hover:underline" onClick={() => openAlertDetails(form.alert_id)}>{form.alert_id}</button> : <span>Manual intake</span>}
              <span>| {form.child_known === "No" ? "Unknown Child" : `${form.child_first_names} ${form.child_surname}`.trim() || "Unknown Child"} | {form.district} | {form.primary_case_category || "Uncategorized"}</span>
            </div>
            {!locked && (
              <div className={`mt-2 text-xs font-bold ${autosaveState === "error" ? "text-[#b42318]" : autosaveState === "saving" ? "text-[#a05b16]" : "text-[#007464]"}`}>
                {autosaveState === "saving" ? "Autosaving..." : autosaveState === "dirty" ? "Unsaved changes" : autosaveState === "error" ? "Autosave failed" : autosavedAt ? `Autosaved ${autosavedAt}` : form.intake_id ? "Autosave ready" : "Draft will save after it is created"}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="grid gap-1 text-right">
              <div className="text-xs font-bold uppercase text-[#64748b]">{screeningClosed ? "Screening SLA" : "SLA countdown"}</div>
              <div className={`text-[18px] font-bold ${sla.status.includes("ON TIME") || sla.status === "ON TIME" ? "text-[#007464]" : sla.status === "DUE SOON" ? "text-[#a05b16]" : "text-[#b42318]"}`}>{screeningClosed ? sla.status : sla.label}</div>
            </div>
            <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={backToIntakeList}>Back to list</button>
          </div>
        </div>
      </div>

      {errors.length > 0 && <div className="rounded-md border border-[#f4b4ac] bg-[#fff7f5] p-4 text-sm font-semibold text-[#b42318]">{errors.map((error) => <div key={error}>{error}</div>)}</div>}
      {savedMessage && <div className="rounded-md border border-[#b7e4d8] bg-[#f0fdf9] p-3 text-sm font-semibold text-[#007464]">{savedMessage}</div>}

      <Panel
        title="Active Intake Workspace"
        icon={FileText}
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-semibold text-[#475569]">{locked ? `Locked - ${form.status.replace(/_/g, " ").toLowerCase()}` : "Draft editable"}</span>
            {editTabButton()}
          </div>
        )}
      >
        <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-[#d8dee8]">
          {tabs.map(([key, label]) => (
            <button key={key} className={`relative min-h-10 whitespace-nowrap rounded-t-md px-3 text-[13px] font-extrabold uppercase tracking-normal transition ${activeTab === key ? "bg-[#e7f6f3] text-[#007464]" : "text-[#31476b] hover:bg-[#f8fafc] hover:text-[#008c7a]"}`} onClick={() => setTab(key)}>
              {label}
              {activeTab === key && <span className="absolute bottom-[-1px] left-0 h-1 w-full rounded-t bg-[#008c7a]" />}
            </button>
          ))}
        </div>

        <fieldset disabled={locked} className={locked ? "opacity-80" : ""}>
          {activeTab === "summary" && (
            <section className="rounded-md border border-[#d8dee8] bg-white p-6 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-[22px] font-bold text-[#10233f]">{convertedFromAlert ? "Original Alert Summary" : "Manual Intake Summary"}</h3>
                  {convertedFromAlert && <div className="mt-1 text-sm font-semibold text-[#64748b]">Converted from {form.alert_id}</div>}
                </div>
                <div className="flex items-center gap-2">
                  {convertedFromAlert && <span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-bold uppercase text-[#64748b]">Auto-populated</span>}
                </div>
              </div>
              {convertedFromAlert ? (
                <div className="space-y-5">
                  <AlertDossierCard title="Alert Summary">
                    <DossierGrid fields={[
                      ["Alert ID", form.alert_id],
                      ["Intake source", "ALERT"],
                      ["Date reported", form.date_reported || summaryAlert?.submittedAt || ""],
                      ["Reporting channel", form.reporting_channel || summaryAlert?.reporting_channel || summaryAlert?.reporterType || ""],
                      ["District", form.district],
                      ["Ward", form.ward],
                      ["Village", form.village || summaryAlert?.village_suburb || ""],
                      ["Nearest landmark", summaryAlert?.nearest_landmark || ""],
                      ["Emergency reported", form.emergency_reported],
                      ["Immediate danger reported", form.immediate_danger_reported],
                      ["Alert status", summaryAlert?.status || "Converted to Case"],
                    ]} />
                    <DossierText title="Brief concern summary" value={form.concern_summary || summaryAlert?.concern || ""} />
                    <DossierText title="Reporter narrative" value={form.reporter_narrative || summaryAlert?.description || ""} />
                  </AlertDossierCard>

                  <AlertDossierCard title="Reporter & Information Source">
                    <DossierGrid fields={[
                      ["Submitted by", summaryAlert ? submittedByLabel(summaryAlert) : form.reporter_type],
                      ["Reporter role", summaryAlert?.reporterType || form.reporter_type],
                      ["Reporter organization", "Not captured"],
                      ["Reporter contact", "Not captured"],
                      ["Information source type", summaryAlert ? sourceTypeLabel(summaryAlert) : form.informant_organization],
                      ["Surname", summaryAlert?.protect_source_identity ? "Protected" : summaryAlert?.information_source_surname || form.informant_surname],
                      ["First names", summaryAlert?.protect_source_identity ? "Protected" : summaryAlert?.information_source_first_names || form.informant_first_names],
                      ["ID number", summaryAlert?.protect_source_identity ? "Protected" : summaryAlert?.information_source_id_number || form.informant_id_number],
                      ["Sex", summaryAlert?.protect_source_identity ? "Protected" : summaryAlert?.information_source_sex || form.informant_sex],
                      ["Source contact", summaryAlert?.protect_source_identity ? "Protected" : summaryAlert?.information_source_contact || form.informant_phone],
                      ["Email", summaryAlert?.protect_source_identity ? "Protected" : summaryAlert?.information_source_email || form.informant_email],
                      ["Address", summaryAlert?.protect_source_identity ? "Protected" : summaryAlert?.information_source_address || form.informant_address],
                      ["Relationship to child", summaryAlert?.information_source_relationship_to_child || summaryAlert?.relationship_to_child || ""],
                      ["Reporter type", summaryAlert?.information_source_reporter_type || form.reporter_type],
                      ["Alternative contact", summaryAlert?.alternative_contact || ""],
                      ["Protect source identity", summaryAlert?.protect_source_identity ? "Yes" : "No"],
                    ]} />
                    <DossierText title="Brief source description" value={summaryAlert?.source_brief_description || ""} />
                  </AlertDossierCard>

                  <AlertDossierCard title="Child, Location & Caregiver">
                    <DossierGrid fields={[
                      ["Child known", summaryAlert?.childName?.toLowerCase().includes("unknown") ? "No" : "Yes"],
                      ["Child first name", summaryAlert?.child_first_name || ""],
                      ["Child surname", summaryAlert?.child_surname || ""],
                      ["Sex", summaryAlert?.sex || form.child_sex],
                      ["Age", summaryAlert?.age || form.child_age],
                      ["Date of birth", summaryAlert?.date_of_birth || ""],
                      ["Birth registered", summaryAlert?.birth_registered || ""],
                      ["Birth certificate number", summaryAlert?.birth_certificate_number || ""],
                      ["Disability", summaryAlert?.disability || ""],
                      ["Current location", summaryAlert?.current_location || form.child_current_location],
                      ["Home address", summaryAlert?.home_address || ""],
                      ["Caregiver name", summaryAlert?.caregiver_name || ""],
                      ["Caregiver contact", summaryAlert?.caregiver_contact || ""],
                      ["Caregiver relationship", summaryAlert?.relationship_to_child || ""],
                      ["Protect caregiver identity", summaryAlert?.protect_reporter_identity ? "Yes" : "No"],
                    ]} />
                  </AlertDossierCard>

                  <AlertDossierCard title="Concern, Danger, Incident & Actions">
                    <DossierChips title="Case categories / concerns" items={form.selected_categories.length ? form.selected_categories : alertConcerns(summaryAlert || alert)} tone="blue" />
                    <DossierChips title="Immediate danger screening" items={summaryAlert?.danger || []} tone="red" empty="No immediate danger factors selected." />
                    <DossierGrid fields={[
                      ["Incident date", summaryAlert?.incident_date || ""],
                      ["Date reporter became aware", summaryAlert?.date_reporter_became_aware || ""],
                      ["Incident location", summaryAlert?.incident_location || ""],
                      ["Alleged perpetrator name", summaryAlert?.alleged_perpetrator_name || ""],
                      ["Alleged perpetrator relationship", summaryAlert?.alleged_perpetrator_relationship || ""],
                      ["Perpetrator has access", summaryAlert?.perpetrator_has_access || ""],
                    ]} />
                    <DossierText title="Immediate action taken" value={summaryAlert?.immediate_action_taken || ""} />
                    <DossierText title="Services contacted" value={summaryAlert?.services_contacted || ""} />
                  </AlertDossierCard>

                  <AlertDossierCard title="Attachments">
                    <DossierAttachments attachments={summaryAlert?.attachments || []} fallback={form.attachments} />
                  </AlertDossierCard>
                </div>
              ) : (
                <FormGrid>
                  <ReadonlyField label="Alert ID" value="Manual intake" />
                  <Field label="Intake source"><select className={inputClass} value={form.intake_source} onChange={(e) => setValue("intake_source", e.target.value)}><option value="">Select intake source</option><option>WALK_IN</option><option>PHONE_CALL</option><option>PARTNER_REFERRAL</option><option>POLICE_REFERRAL</option><option>SCHOOL_REFERRAL</option><option>HEALTH_FACILITY_REFERRAL</option><option>OTHER</option></select></Field>
                  <Field label="Date reported"><input className={inputClass} type="date" value={form.date_reported} onChange={(e) => setValue("date_reported", e.target.value)} /></Field>
                  <Field label="Reporting channel"><input className={inputClass} value={form.reporting_channel} onChange={(e) => setValue("reporting_channel", e.target.value)} /></Field>
                  <Field label="District"><select className={inputClass} value={form.district} onChange={(e) => setValue("district", e.target.value)}><option value="">Select district</option>{districts.map((district) => <option key={district.id}>{district.name}</option>)}</select></Field>
                  <Field label="Ward"><select className={inputClass} value={form.ward} onChange={(e) => setValue("ward", e.target.value)}><option value="">Select ward</option>{wards.filter((ward) => ward.districtName === form.district).map((ward) => <option key={ward.id}>{ward.name}</option>)}</select></Field>
                  <Field label="Village"><input className={inputClass} value={form.village} onChange={(e) => setValue("village", e.target.value)} /></Field>
                  <Field label="Emergency reported"><select className={inputClass} value={form.emergency_reported} onChange={(e) => setValue("emergency_reported", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
                  <Field label="Immediate danger reported"><select className={inputClass} value={form.immediate_danger_reported} onChange={(e) => setValue("immediate_danger_reported", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
                  <Field label="Attachments"><input className={inputClass} value={form.attachments} onChange={(e) => setValue("attachments", e.target.value)} /></Field>
                  <div className="md:col-span-2"><Field label="Brief concern summary"><textarea className={`${inputClass} min-h-[110px] py-3`} value={form.concern_summary} onChange={(e) => setValue("concern_summary", e.target.value)} /></Field></div>
                  <div className="md:col-span-2"><Field label="Reporter narrative"><textarea className={`${inputClass} min-h-[130px] py-3`} value={form.reporter_narrative} onChange={(e) => setValue("reporter_narrative", e.target.value)} /></Field></div>
                </FormGrid>
              )}
            </section>
          )}

          {activeTab === "officer" && (
            <div className="space-y-5">
              <section className="rounded-md border border-[#d8dee8] bg-white p-6 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-base font-bold text-[#263747]">Officer Details</h3>
                  <span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-bold uppercase text-[#64748b]">Auto-populated</span>
                </div>
                <FormGrid>
                  <ReadonlyField label="Officer user ID" value={form.officer_user_id} />
                  <ReadonlyField label="Surname" value={form.officer_surname} />
                  <ReadonlyField label="First names" value={form.officer_first_names} />
                  <ReadonlyField label="Designation" value={form.officer_designation} />
                  <ReadonlyField label="Officer district" value={form.officer_district} />
                  <ReadonlyField label="Officer contact" value={form.officer_contact} />
                </FormGrid>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-white p-6 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-base font-bold text-[#263747]">Informant / Reporter Details</h3>
                  {convertedFromAlert && (
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-bold uppercase text-[#64748b]">Auto-populated</span>
                    </div>
                  )}
                </div>
                {convertedFromAlert ? (
                  <FormGrid>
                    <ReadonlyField label="Surname" value={form.informant_surname || "Not captured"} />
                    <ReadonlyField label="First names" value={form.informant_first_names || "Not captured"} />
                    <ReadonlyField label="ID number" value={form.informant_id_number || "Not captured"} />
                    <ReadonlyField label="Sex" value={form.informant_sex || "Not captured"} />
                    <ReadonlyField label="Relationship to child" value={form.informant_relationship_to_child || "Not captured"} />
                    <ReadonlyField label="Phone" value={form.informant_phone || "Not captured"} />
                    <ReadonlyField label="Email" value={form.informant_email || "Not captured"} />
                    <ReadonlyField label="Organization" value={form.informant_organization || "Not captured"} />
                    <ReadonlyField label="Confidentiality requested" value={form.informant_wants_confidentiality || "Not captured"} />
                    <ReadonlyField label="Reporter type" value={form.reporter_type || "Not captured"} />
                    <div className="md:col-span-2"><ReadonlyArea label="Address" value={form.informant_address} /></div>
                  </FormGrid>
                ) : (
                  <FormGrid>
                    <Field label="Surname"><input className={inputClass} value={form.informant_surname} onChange={(e) => setValue("informant_surname", e.target.value)} /></Field>
                    <Field label="First names"><input className={inputClass} value={form.informant_first_names} onChange={(e) => setValue("informant_first_names", e.target.value)} /></Field>
                    <Field label="ID number"><input className={inputClass} value={form.informant_id_number} onChange={(e) => setValue("informant_id_number", e.target.value)} /></Field>
                    <Field label="Sex"><select className={inputClass} value={form.informant_sex} onChange={(e) => setValue("informant_sex", e.target.value)}><option value="">Select sex</option><option>MALE</option><option>FEMALE</option><option>UNKNOWN</option></select></Field>
                    <Field label="Relationship to child"><input className={inputClass} value={form.informant_relationship_to_child} onChange={(e) => setValue("informant_relationship_to_child", e.target.value)} /></Field>
                    <Field label="Phone"><input className={inputClass} value={form.informant_phone} onChange={(e) => setValue("informant_phone", e.target.value)} /></Field>
                    <Field label="Email"><input className={inputClass} value={form.informant_email} onChange={(e) => setValue("informant_email", e.target.value)} /></Field>
                    <Field label="Organization"><input className={inputClass} value={form.informant_organization} onChange={(e) => setValue("informant_organization", e.target.value)} /></Field>
                    <Field label="Confidentiality requested"><select className={inputClass} value={form.informant_wants_confidentiality} onChange={(e) => setValue("informant_wants_confidentiality", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
                    <Field label="Reporter type"><select className={inputClass} value={form.reporter_type} onChange={(e) => setValue("reporter_type", e.target.value)}><option value="">Select reporter type</option><option>CCW</option><option>PARENT</option><option>GUARDIAN</option><option>CHILD_SELF_REPORT</option><option>POLICE</option><option>SCHOOL</option><option>HEALTH_WORKER</option><option>NGO_PARTNER</option><option>COMMUNITY_MEMBER</option><option>OTHER</option></select></Field>
                    <div className="md:col-span-2"><Field label="Address"><textarea className={`${inputClass} min-h-[90px] py-3`} value={form.informant_address} onChange={(e) => setValue("informant_address", e.target.value)} /></Field></div>
                  </FormGrid>
                )}
              </section>
            </div>
          )}

          {activeTab === "child" && (
            <section className="rounded-md border border-[#d8dee8] bg-white p-6 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-[22px] font-bold text-[#10233f]">Child Details</h3>
              </div>
              <FormGrid>
                <Field label="Child known"><select className={inputClass} value={form.child_known} onChange={(e) => setValue("child_known", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
                <Field label="Surname"><input className={`${inputClass} ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={form.child_surname} onChange={(e) => setValue("child_surname", e.target.value)} disabled={childUnknown} /></Field>
                <Field label="First names"><input className={`${inputClass} ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={form.child_first_names} onChange={(e) => setValue("child_first_names", e.target.value)} disabled={childUnknown} /></Field>
                <Field label="ID number"><input className={`${inputClass} ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={form.child_id_number} onChange={(e) => setValue("child_id_number", e.target.value)} disabled={childUnknown} /></Field>
                <Field label="Sex"><select className={inputClass} value={form.child_sex} onChange={(e) => setValue("child_sex", e.target.value)}><option value="">Select sex</option><option>MALE</option><option>FEMALE</option><option>UNKNOWN</option></select></Field>
                <Field label="Date of birth"><input className={`${inputClass} ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} type="date" value={form.child_date_of_birth} onChange={(e) => setValue("child_date_of_birth", e.target.value)} disabled={childUnknown} /></Field>
                <Field label="Age"><input className={inputClass} value={form.child_age} onChange={(e) => setValue("child_age", e.target.value)} /></Field>
                <Field label="Age estimated"><select className={inputClass} value={form.age_is_estimated} onChange={(e) => setValue("age_is_estimated", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
                <Field label="Birth registered"><select className={inputClass} value={form.birth_registered} onChange={(e) => setValue("birth_registered", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                <Field label="Disability status"><select className={inputClass} value={form.disability_status} onChange={(e) => setValue("disability_status", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                <Field label="Child contact details"><input className={`${inputClass} ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={form.child_contact_details} onChange={(e) => setValue("child_contact_details", e.target.value)} disabled={childUnknown} /></Field>
                <Field label="Home language"><input className={inputClass} value={form.home_language} onChange={(e) => setValue("home_language", e.target.value)} /></Field>
                <Field label="Child current location"><input className={inputClass} value={form.child_current_location} onChange={(e) => setValue("child_current_location", e.target.value)} /></Field>
                <Field label="Child safe now"><select className={inputClass} value={form.child_is_safe_now} onChange={(e) => setValue("child_is_safe_now", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                <Field label="Caregiver present"><select className={inputClass} value={form.caregiver_present} onChange={(e) => setValue("caregiver_present", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                <div className="md:col-span-2"><Field label="Child address"><textarea className={`${inputClass} min-h-[90px] py-3 ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={form.child_address} onChange={(e) => setValue("child_address", e.target.value)} disabled={childUnknown} /></Field></div>
                <div className="md:col-span-2"><Field label="Disability description"><textarea className={`${inputClass} min-h-[90px] py-3`} value={form.disability_description} onChange={(e) => setValue("disability_description", e.target.value)} /></Field></div>
              </FormGrid>
            </section>
          )}

          {activeTab === "family" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h3 className="text-base font-bold text-[#263747]">Family / Guardian Details</h3><p className="text-sm text-[#64748b]">Capture father/male guardian and mother/female guardian where known. More relatives can be added later.</p></div>
                <div className="flex flex-wrap gap-2">
                  {!locked && <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={openAddGuardianModal}><Plus className="h-4 w-4" /> Add guardian</button>}
                </div>
              </div>
              <div className="overflow-x-auto rounded-md border border-[#d8dee8]">
                <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
                  <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["No", "Type", "Name", "ID", "Address", "Telephone", "Relationship", "Primary", "Notes", "Action"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
                  <tbody>
                    {guardians.length ? guardians.map((item, index) => (
                      <tr key={`${item.telephone}-${index}`} className={`bg-white ${locked ? "" : "cursor-pointer hover:bg-[#f8fafc]"}`} onClick={() => openEditGuardianModal(index)}>
                        <td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]">{index + 1}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3">{item.guardian_type}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3">{item.first_names} {item.surname}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3">{item.id_number || "-"}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3">{item.address}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3">{item.telephone}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3">{item.relationship_to_child}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3">{item.is_primary_caregiver}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3">{item.notes || "-"}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3">
                          <div className="flex items-center gap-2">
                            <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#2e6fa3] hover:border-[#008c7a] hover:text-[#008c7a] disabled:cursor-not-allowed disabled:opacity-45" title="Edit guardian" disabled={locked} onClick={(event) => { event.stopPropagation(); openEditGuardianModal(index) }}>
                              <PencilLine className="h-4 w-4" />
                            </button>
                            <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#f4b4ac] bg-white text-[#b42318] hover:bg-[#fff7f5] disabled:cursor-not-allowed disabled:opacity-45" title="Delete guardian" disabled={locked} onClick={(event) => { event.stopPropagation(); deleteGuardian(index) }}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={10}>No parent or guardian captured yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "case" && (
            <div className="space-y-5">
              <div className="rounded-md border border-[#d8dee8] bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[22px] font-bold text-[#10233f]">Case Type / Categorization</h3>
                </div>
              </div>
              <CaseTypeSection title="Protection Case Types" sections={protectionTypeSections} selected={form.selected_categories} onToggle={(item) => toggleArray("selected_categories", item)} />
              <CaseTypeSection title="Welfare Case Types" sections={welfareTypeSections} selected={form.selected_categories} onToggle={(item) => toggleArray("selected_categories", item)} />
              <CaseTypeGroup title="Court Orders" items={courtTypes} selected={form.selected_categories} onToggle={(item) => toggleArray("selected_categories", item)} />
              {showJuvenileOffences && <CaseTypeSection title="Juvenile Delinquency Offences" subtitle="If applicable; check all that apply." sections={juvenileOffenceSections} selected={form.selected_categories} onToggle={(item) => toggleArray("selected_categories", item)} />}
              <FormGrid>
                <Field label="Primary case category"><select className={inputClass} value={form.primary_case_category} onChange={(e) => setValue("primary_case_category", e.target.value)}><option value="">Select primary category</option>{form.selected_categories.map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field label="Case category notes"><input className={inputClass} value={form.case_category_notes} onChange={(e) => setValue("case_category_notes", e.target.value)} /></Field>
                <div className="md:col-span-2"><Field label="Concern description"><textarea className={`${inputClass} min-h-[110px] py-3`} value={form.concern_description} onChange={(e) => setValue("concern_description", e.target.value)} /></Field></div>
              </FormGrid>
              <div className={`rounded-md border p-4 ${requiresProsecution ? "border-[#d8dee8] bg-white" : "border-[#edf0f4] bg-[#f8fafc]"}`}>
                <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-base font-bold text-[#263747]">Prosecution / Alleged Perpetrator</h3><StatusPill label={requiresProsecution ? "Required for selected category" : "Collapsed until relevant"} tone={requiresProsecution ? "warning" : "draft"} /></div>
                {requiresProsecution && (
                  <FormGrid>
                    <Field label="Perpetrator known" required><select className={inputClass} value={form.alleged_perpetrator_known} onChange={(e) => setValue("alleged_perpetrator_known", e.target.value)} required><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                    <Field label="Accused name" required={form.alleged_perpetrator_known === "Yes"}><input className={inputClass} value={form.accused_name} onChange={(e) => setValue("accused_name", e.target.value)} required={form.alleged_perpetrator_known === "Yes"} /></Field>
                    <Field label="Relationship to child"><select className={inputClass} value={form.accused_relationship_to_child} onChange={(e) => setValue("accused_relationship_to_child", e.target.value)}><option value="">Select relationship</option><option>FATHER</option><option>MOTHER</option><option>GUARDIAN</option><option>RELATIVE</option><option>TEACHER</option><option>COMMUNITY_MEMBER</option><option>UNKNOWN</option><option>OTHER</option></select></Field>
                    <Field label="Accused sex"><select className={inputClass} value={form.accused_sex} onChange={(e) => setValue("accused_sex", e.target.value)}><option value="">Select sex</option><option>MALE</option><option>FEMALE</option><option>UNKNOWN</option></select></Field>
                    <Field label="Referred to police"><select className={inputClass} value={form.referred_to_police} onChange={(e) => setValue("referred_to_police", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                    <Field label="Police reference number"><input className={inputClass} value={form.police_reference_number} onChange={(e) => setValue("police_reference_number", e.target.value)} /></Field>
                    {form.referred_to_police === "Yes" && <Field label="Police referral date"><input className={inputClass} type="date" value={form.police_referral_date} onChange={(e) => setValue("police_referral_date", e.target.value)} /></Field>}
                    <Field label="Court appearance scheduled"><select className={inputClass} value={form.court_appearance_scheduled} onChange={(e) => setValue("court_appearance_scheduled", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                    {form.court_appearance_scheduled === "Yes" && <Field label="Court appearance date"><input className={inputClass} type="date" value={form.court_appearance_date} onChange={(e) => setValue("court_appearance_date", e.target.value)} /></Field>}
                    <Field label="Conviction determined"><select className={inputClass} value={form.conviction_determined} onChange={(e) => setValue("conviction_determined", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                    {form.conviction_determined === "Yes" && <Field label="Conviction date"><input className={inputClass} type="date" value={form.conviction_date} onChange={(e) => setValue("conviction_date", e.target.value)} /></Field>}
                    <Field label="Accused address"><input className={inputClass} value={form.accused_address} onChange={(e) => setValue("accused_address", e.target.value)} /></Field>
                    <div className="md:col-span-2"><Field label="Circumstances of offence"><textarea className={`${inputClass} min-h-[110px] py-3`} value={form.circumstances_of_offence} onChange={(e) => setValue("circumstances_of_offence", e.target.value)} /></Field></div>
                  </FormGrid>
                )}
              </div>
            </div>
          )}

          {activeTab === "background" && (
            <div className="space-y-5">
              <div className="rounded-md border border-[#d8dee8] bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[22px] font-bold text-[#10233f]">Other Background Information</h3>
                </div>
              </div>
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-[#263747]">Prior Assistance / Other Organisation Contact</h3>
                    <div className="mt-1 text-sm text-[#64748b]">Captured against partners or districts from the configured models.</div>
                  </div>
                  <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={addPriorAssistance}><Plus className="h-4 w-4" /> Add record</button>
                </div>
                <div className="space-y-4">
                  {form.prior_assistance.length ? form.prior_assistance.map((item, index) => (
                    <article key={`prior-assistance-${index}`} className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#dfe4eb] pb-3">
                        <div>
                          <div className="text-sm font-extrabold uppercase text-[#2e6fa3]">Record {form.prior_assistance.length - index}</div>
                          <div className="mt-1 text-lg font-bold text-[#263747]">{priorAssistanceName(item)}</div>
                        </div>
                        <button type="button" className="inline-flex h-9 items-center gap-2 rounded-md border border-[#f4b4ac] bg-white px-3 text-sm font-semibold text-[#b42318]" onClick={() => removePriorAssistance(index)}><Trash2 className="h-4 w-4" /> Remove</button>
                      </div>
                      <FormGrid>
                        <Field label="Information known">
                          <div className="flex min-h-11 flex-wrap items-center gap-3 rounded-md border border-[#d8dee8] bg-white px-3">
                            {["Yes", "No", "Unknown"].map((value) => (
                              <label key={value} className="inline-flex items-center gap-2 text-sm font-semibold text-[#263747]">
                                <input type="radio" className="h-4 w-4 accent-[#008c7a]" checked={item.information_known === value} onChange={() => updatePriorAssistance(index, "information_known", value)} />
                                {value}
                              </label>
                            ))}
                          </div>
                        </Field>
                        <Field label="Source">
                          <div className="flex min-h-11 flex-wrap items-center gap-3 rounded-md border border-[#d8dee8] bg-white px-3">
                            {[["PARTNER", "Partner"], ["DISTRICT", "District"]].map(([value, label]) => (
                              <label key={value} className="inline-flex items-center gap-2 text-sm font-semibold text-[#263747]">
                                <input type="radio" className="h-4 w-4 accent-[#008c7a]" checked={item.source_type === value} disabled={item.information_known !== "Yes"} onChange={() => updatePriorAssistance(index, "source_type", value)} />
                                {label}
                              </label>
                            ))}
                          </div>
                        </Field>
                        {item.source_type === "PARTNER" && (
                          <Field label="Partner">
                            <select className={inputClass} value={item.partner_id} onChange={(e) => updatePriorAssistance(index, "partner_id", e.target.value)}>
                              <option value="">Select partner</option>
                              {organizations.map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}
                              {!organizations.length && <option value="" disabled>No partners configured</option>}
                            </select>
                          </Field>
                        )}
                        {item.source_type === "DISTRICT" && (
                          <Field label="District">
                            <select className={inputClass} value={item.district_id} onChange={(e) => updatePriorAssistance(index, "district_id", e.target.value)}>
                              <option value="">Select district</option>
                              {districts.map((district) => <option key={district.id} value={district.id}>{district.name}</option>)}
                              <option value="OTHER">Other district not listed</option>
                            </select>
                          </Field>
                        )}
                        {item.district_id === "OTHER" && <Field label="Other district"><input className={inputClass} value={item.other_district} onChange={(e) => updatePriorAssistance(index, "other_district", e.target.value)} /></Field>}
                        <Field label="Date received / known"><input className={inputClass} type="date" value={item.service_date} onChange={(e) => updatePriorAssistance(index, "service_date", e.target.value)} /></Field>
                        <Field label="Status / outcome">
                          <select className={inputClass} value={item.status} onChange={(e) => updatePriorAssistance(index, "status", e.target.value)}>
                            <option value="">Select status</option>
                            <option>Completed</option>
                            <option>Ongoing</option>
                            <option>Referred</option>
                            <option>No response</option>
                            <option>Unknown</option>
                          </select>
                        </Field>
                      </FormGrid>
                      {item.information_known === "Yes" && (
                        <div className="mt-4">
                          <div className="mb-2 text-sm font-semibold text-[#263747]">Services already received</div>
                          <div className="max-h-[260px] overflow-auto rounded-md border border-[#d8dee8] bg-white p-3">
                            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                              {services.map((service) => (
                                <label key={service} className={`flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${item.services.includes(service) ? "border-[#008c7a] bg-[#e7f6f3] text-[#007464]" : "border-[#edf0f4] bg-white text-[#30528c]"}`}>
                                  <input type="checkbox" className="h-4 w-4 accent-[#008c7a]" checked={item.services.includes(service)} onChange={() => togglePriorAssistanceService(index, service)} />
                                  <span>{service}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                          {item.services.includes("Other") && (
                            <div className="mt-3 max-w-xl">
                              <Field label="Specify other service"><input className={inputClass} value={item.other_service} onChange={(e) => updatePriorAssistance(index, "other_service", e.target.value)} /></Field>
                            </div>
                          )}
                        </div>
                      )}
                      <FormGrid>
                        <div className="md:col-span-2"><Field label="Outcome / feedback"><textarea className={`${inputClass} min-h-[80px] py-3`} value={item.outcome} onChange={(e) => updatePriorAssistance(index, "outcome", e.target.value)} /></Field></div>
                        <div className="md:col-span-2"><Field label="Notes / reference numbers"><textarea className={`${inputClass} min-h-[80px] py-3`} value={item.notes} onChange={(e) => updatePriorAssistance(index, "notes", e.target.value)} /></Field></div>
                      </FormGrid>
                    </article>
                  )) : (
                    <div className="rounded-md border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-6 text-center">
                      <div className="font-bold text-[#263747]">No prior assistance captured yet.</div>
                      <div className="mt-1 text-sm text-[#64748b]">Add a partner or district record when the child or family received services before this intake.</div>
                    </div>
                  )}
                </div>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h3 className="mb-4 text-base font-bold text-[#263747]">Details</h3>
                <div className="space-y-4">
                  <FormGrid>
                    <Field label="Previous contact with DSD"><select className={inputClass} value={form.previous_contact_with_dsd} onChange={(e) => setValue("previous_contact_with_dsd", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                    <Field label="Previous contact with law enforcement"><select className={inputClass} value={form.previous_contact_with_law} onChange={(e) => setValue("previous_contact_with_law", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                    <div className="md:col-span-2"><Field label="Previous court orders"><textarea className={`${inputClass} min-h-[80px] py-3`} value={form.previous_court_orders} onChange={(e) => setValue("previous_court_orders", e.target.value)} /></Field></div>
                    <div className="md:col-span-2"><Field label="Other agencies previously involved"><textarea className={`${inputClass} min-h-[80px] py-3`} value={form.previous_contact_with_other_agencies} onChange={(e) => setValue("previous_contact_with_other_agencies", e.target.value)} /></Field></div>
                  </FormGrid>
                  <Field label="Other background information"><textarea className={`${inputClass} min-h-[90px] py-3`} value={form.other_background_information} onChange={(e) => setValue("other_background_information", e.target.value)} /></Field>
                  <Field label="Child story or reported circumstances"><textarea className={`${inputClass} min-h-[90px] py-3`} value={form.child_story_or_reported_circumstances} onChange={(e) => setValue("child_story_or_reported_circumstances", e.target.value)} /></Field>
                  <Field label="Background service notes"><textarea className={`${inputClass} min-h-[80px] py-3`} value={form.background_service_notes} onChange={(e) => setValue("background_service_notes", e.target.value)} /></Field>
                </div>
              </section>
            </div>
          )}

          {activeTab === "plan" && (
            <div className="space-y-5">
              <div className="rounded-md border border-[#d8dee8] bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[22px] font-bold text-[#10233f]">Immediate Needs / Emergency Response</h3>
                    <p className="mt-1 text-sm text-[#64748b]">Capture only urgent actions needed before assessment. The full case plan remains for the assessment stage.</p>
                  </div>
                </div>
              </div>
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <FormGrid>
                  <Field label="Immediate intervention needed"><select className={inputClass} value={form.immediate_intervention_needed} onChange={(e) => setValue("immediate_intervention_needed", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
                  <Field label="Supervisor notified"><select className={inputClass} value={supervisorNotified ? "Yes" : ""} onChange={(e) => setSupervisorNotified(e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
                </FormGrid>
                {supervisorNotified && (
                  <div className="mt-4 rounded-md border border-[#b7e4d8] bg-[#f0fdf9] px-4 py-3 text-sm font-semibold text-[#007464]">
                    Supervisor notified by {form.supervisor_notified_by || "current user"} at {form.supervisor_notified_at || "now"}.
                  </div>
                )}
              </section>
              {form.immediate_intervention_needed === "Yes" && <CaseTypeSection title="Immediate Actions" sections={immediateResponseActionSections} selected={form.immediate_response_actions} onToggle={(item) => toggleArray("immediate_response_actions", item)} />}
              {form.immediate_intervention_needed === "Yes" && form.immediate_response_actions.some((action) => action !== "Supervisor notified") && (
                <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-[#263747]">Immediate Action Due Dates</h3>
                      <p className="mt-1 text-sm text-[#64748b]">Emergency actions are automatically due within 24 hours.</p>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {form.immediate_response_actions.filter((action) => action !== "Supervisor notified").map((action) => (
                      <div key={action} className="rounded-md border border-[#f4b4ac] bg-[#fff7f5] p-4">
                        <div className="text-sm font-extrabold text-[#263747]">{action}</div>
                        <div className="mt-3 text-xs font-bold uppercase text-[#9f3a2f]">Due date</div>
                        <div className="mt-1 text-lg font-extrabold text-[#9f3a2f]">In 24 hours</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <Field label="Immediate notes"><textarea className={`${inputClass} min-h-[130px] py-3`} value={form.immediate_action_plan} onChange={(e) => { setValue("immediate_action_plan", e.target.value); setValue("action_plan", e.target.value) }} /></Field>
              </section>
            </div>
          )}

          {activeTab === "screening" && (
            <div className="space-y-5">
              <div className="rounded-md border border-[#d8dee8] bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[22px] font-bold text-[#10233f]">Screening & Submit</h3>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <MiniCard title="48h Screening Due" value={manualDeadlines.screening.dueLabel} icon={Clock3} />
                <MiniCard title="7d Assessment Due" value={manualDeadlines.assessment.dueLabel} icon={FileSearch} />
                <MiniCard title="14d Case Conference" value={manualDeadlines.conference.dueLabel} icon={Users} />
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <MiniCard title="Duplicate Status" value={duplicateMatches.length ? possibleMatchLabel : form.duplicate_status.replace(/_/g, " ")} icon={Search} />
                <MiniCard title="System Risk" value={form.system_recommended_risk} icon={AlertTriangle} />
                <MiniCard title="6m Formal Review" value={manualDeadlines.formalReview.dueLabel} icon={CalendarDays} />
              </div>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <section className="space-y-4">
                  <FormGrid>
                    <Field label="Alert validity"><select className={inputClass} value={form.alert_validity} onChange={(e) => setValue("alert_validity", e.target.value)}><option value="">Select validity</option><option>VALID</option><option>INVALID_FALSE_REPORT</option><option>INSUFFICIENT_INFORMATION</option><option>OUT_OF_MANDATE</option></select></Field>
                    <Field label="Immediate danger"><select className={inputClass} value={form.immediate_danger} onChange={(e) => setValue("immediate_danger", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
                    <Field label="Emergency required"><select className={inputClass} value={form.emergency_required} onChange={(e) => setValue("emergency_required", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
                  </FormGrid>
                  <CaseTypeGroup title="Vulnerability Factors" items={vulnerabilityFactors} selected={form.vulnerability_factors} onToggle={(item) => toggleArray("vulnerability_factors", item)} />
                  <FormGrid>
                    <div className="md:col-span-2"><Field label="Safety concerns"><textarea className={`${inputClass} min-h-[90px] py-3`} value={form.safety_concerns} onChange={(e) => setValue("safety_concerns", e.target.value)} /></Field></div>
                    <div className="md:col-span-2"><Field label="Immediate action plan"><textarea className={`${inputClass} min-h-[110px] py-3`} value={form.immediate_action_plan} onChange={(e) => setValue("immediate_action_plan", e.target.value)} /></Field></div>
                    <div className="md:col-span-2"><Field label="Screening notes"><textarea className={`${inputClass} min-h-[90px] py-3`} value={form.screening_notes} onChange={(e) => setValue("screening_notes", e.target.value)} /></Field></div>
                  </FormGrid>
                </section>
                <aside className="space-y-4">
                  <div className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-3 text-sm font-semibold text-[#475569]">
                    Duplicate and risk checks update automatically from the captured intake details.
                  </div>
                  <div className="rounded-md border border-[#d8dee8] bg-white p-3">
                    <h3 className="mb-2 font-bold text-[#263747]">{possibleMatchLabel}</h3>
                    {duplicateMatches.length ? duplicateMatches.map((item) => (
                      <div key={item.case_id} className="mb-2 rounded-md bg-[#f8fafc] p-3 text-sm">
                        <div className="font-bold text-[#263747]">{item.case_id} | {item.match_score}%</div>
                        <div>{item.childName} | {item.age} | {item.district}</div>
                        <div className="mt-1 text-[#64748b]">{item.concern} | {item.status}</div>
                        <div className="mt-1 text-xs font-semibold text-[#64748b]">{item.match_reasons.join(", ")}</div>
                      </div>
                    )) : <div className="text-sm text-[#64748b]">No possible duplicate displayed.</div>}
                  </div>
                  <Field label="Duplicate decision"><select className={inputClass} value={form.duplicate_decision} onChange={(e) => setValue("duplicate_decision", e.target.value)}><option value="">No decision</option><option>CONTINUE_AS_NEW</option><option>LINK_TO_EXISTING_CASE</option><option>MERGE_WITH_EXISTING_CASE</option></select></Field>
                  <Field label="Linked case ID"><input className={inputClass} value={form.linked_case_id} onChange={(e) => setValue("linked_case_id", e.target.value)} /></Field>
                </aside>
              </div>
              <FormGrid>
                <div className="md:col-span-2"><Field label="Closure reason"><input className={inputClass} value={form.closure_reason} onChange={(e) => setValue("closure_reason", e.target.value)} /></Field></div>
                <div className="md:col-span-2"><Field label="Submission comments"><textarea className={`${inputClass} min-h-[90px] py-3`} value={form.submission_comments} onChange={(e) => setValue("submission_comments", e.target.value)} /></Field></div>
              </FormGrid>
            </div>
          )}
        </fieldset>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#dfe4eb] pt-4">
          <div className="text-sm font-semibold text-[#64748b]">{locked ? `Locked - ${form.status.replace(/_/g, " ").toLowerCase()}` : autosavedAt ? `Autosaved ${autosavedAt}` : "Autosave active"}</div>
          <div className="flex flex-wrap gap-2">
            {activeTab !== "summary" && <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 text-sm font-semibold text-[#263747]" onClick={() => setTab(tabs[Math.max(0, tabs.findIndex(([key]) => key === activeTab) - 1)][0])}>Back</button>}
            {activeTab !== "screening" && <button className="rounded-md bg-[#008c7a] px-5 py-2 text-sm font-semibold text-white" onClick={() => setTab(tabs[Math.min(tabs.length - 1, tabs.findIndex(([key]) => key === activeTab) + 1)][0])}>Next</button>}
            {activeTab === "screening" && !locked && (
              <>
                <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 text-sm font-semibold text-[#263747]" onClick={closeInvalid}>Close Invalid</button>
                <button className="rounded-md bg-[#008c7a] px-5 py-2 text-sm font-semibold text-white" onClick={submitToSupervisor}>Submit to Supervisor</button>
              </>
            )}
          </div>
        </div>
      </Panel>

      {showGuardianModal && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-[#0f172a]/45 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-md bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-[#dfe4eb] pb-3">
              <h3 className="text-lg font-bold text-[#263747]">{editingGuardianIndex === null ? "Add Parent / Guardian" : "Edit Parent / Guardian"}</h3>
              <button className="rounded-md border border-[#d8dee8] px-3 py-1 font-semibold" onClick={closeGuardianModal}>Close</button>
            </div>
            <FormGrid>
              <Field label="Guardian type"><select className={inputClass} value={guardianDraft.guardian_type} onChange={(e) => setGuardianDraft({ ...guardianDraft, guardian_type: e.target.value })}><option value="">Select guardian type</option><option>FATHER</option><option>MOTHER</option><option>MALE_GUARDIAN</option><option>FEMALE_GUARDIAN</option><option>OTHER</option></select></Field>
              <Field label="Surname"><input className={inputClass} value={guardianDraft.surname} onChange={(e) => setGuardianDraft({ ...guardianDraft, surname: e.target.value })} /></Field>
              <Field label="First names"><input className={inputClass} value={guardianDraft.first_names} onChange={(e) => setGuardianDraft({ ...guardianDraft, first_names: e.target.value })} /></Field>
              <Field label="ID number"><input className={inputClass} value={guardianDraft.id_number} onChange={(e) => setGuardianDraft({ ...guardianDraft, id_number: e.target.value })} /></Field>
              <Field label="DOB or age"><input className={inputClass} value={guardianDraft.dob_or_age} onChange={(e) => setGuardianDraft({ ...guardianDraft, dob_or_age: e.target.value })} /></Field>
              <Field label="Occupation"><input className={inputClass} value={guardianDraft.occupation} onChange={(e) => setGuardianDraft({ ...guardianDraft, occupation: e.target.value })} /></Field>
              <Field label="Employer"><input className={inputClass} value={guardianDraft.employer} onChange={(e) => setGuardianDraft({ ...guardianDraft, employer: e.target.value })} /></Field>
              <Field label="Telephone"><input className={inputClass} value={guardianDraft.telephone} onChange={(e) => setGuardianDraft({ ...guardianDraft, telephone: e.target.value })} /></Field>
              <Field label="Relationship to child"><input className={inputClass} value={guardianDraft.relationship_to_child} onChange={(e) => setGuardianDraft({ ...guardianDraft, relationship_to_child: e.target.value })} /></Field>
              <Field label="Primary caregiver"><select className={inputClass} value={guardianDraft.is_primary_caregiver} onChange={(e) => setGuardianDraft({ ...guardianDraft, is_primary_caregiver: e.target.value })}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
              <Field label="Deceased or abandoned"><select className={inputClass} value={guardianDraft.is_deceased_or_abandoned} onChange={(e) => setGuardianDraft({ ...guardianDraft, is_deceased_or_abandoned: e.target.value })}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
              <Field label="Address"><input className={inputClass} value={guardianDraft.address} onChange={(e) => setGuardianDraft({ ...guardianDraft, address: e.target.value })} /></Field>
              <div className="md:col-span-2"><Field label="Notes"><textarea className={`${inputClass} min-h-[90px] py-3`} value={guardianDraft.notes} onChange={(e) => setGuardianDraft({ ...guardianDraft, notes: e.target.value })} /></Field></div>
            </FormGrid>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-md border border-[#d8dee8] px-4 py-2 font-semibold" onClick={closeGuardianModal}>Cancel</button>
              <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={saveGuardian}>{editingGuardianIndex === null ? "Save guardian" : "Update guardian"}</button>
            </div>
          </div>
        </div>
      )}

      {submissionDialog && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="w-full max-w-md rounded-md border border-[#cfe4df] bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#e7f6f3] text-[#008c7a]">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-xl font-bold text-[#263747]">Case submitted successfully</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7191]">{submissionDialog.detail}</p>
            <button className="mt-6 h-11 rounded-md bg-[#008c7a] px-8 font-semibold text-white hover:bg-[#007767]" onClick={() => setSubmissionDialog(null)}>OK</button>
          </div>
        </div>
      )}
      {requestTab && (
        <RequestUpdateModal
          intakeId={form.intake_id || undefined}
          caseReference={form.case_id}
          tab={requestTab}
          onClose={() => setRequestTab(null)}
        />
      )}
    </div>
  )
}

function CaseTypeGroup({ title, items, selected, onToggle }: { title: string; items: string[]; selected: string[]; onToggle: (item: string) => void }) {
  return (
    <section className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
      <h3 className="mb-3 text-sm font-bold uppercase text-[#2e6fa3]">{title}</h3>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <label key={item} className={`flex min-h-11 items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm font-semibold ${selected.includes(item) ? "border-[#008c7a] text-[#007464] ring-2 ring-[#008c7a]/10" : "border-[#d8dee8] text-[#263747]"}`}>
            <input type="checkbox" className="h-4 w-4 accent-[#008c7a]" checked={selected.includes(item)} onChange={() => onToggle(item)} />
            <span>{item}</span>
          </label>
        ))}
      </div>
    </section>
  )
}

function CaseTypeSection({ title, subtitle, sections, selected, onToggle }: { title: string; subtitle?: string; sections: Array<{ title: string; items: string[] }>; selected: string[]; onToggle: (item: string) => void }) {
  return (
    <section className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
      <div className="mb-4">
        <h3 className="text-sm font-bold uppercase text-[#2e6fa3]">{title}</h3>
        {subtitle && <p className="mt-1 text-sm font-semibold text-[#64748b]">{subtitle}</p>}
      </div>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <div key={section.title} className="rounded-md border border-[#d8dee8] bg-white p-3">
            <h4 className="mb-2 text-sm font-extrabold text-[#263747]">{section.title}</h4>
            <div className="space-y-2">
              {section.items.map((item) => (
                <label key={item} className={`flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${selected.includes(item) ? "border-[#008c7a] bg-[#e7f6f3] text-[#007464]" : "border-[#edf0f4] bg-[#fbfdff] text-[#263747]"}`}>
                  <input type="checkbox" className="h-4 w-4 accent-[#008c7a]" checked={selected.includes(item)} onChange={() => onToggle(item)} />
                  <span>{item}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function StatusPill({ label, tone }: { label: string; tone: "draft" | "review" | "warning" | "danger" }) {
  const styles = {
    draft: "bg-[#fff4d6] text-[#8a5b00]",
    review: "bg-[#eee7f6] text-[#6b3fa0]",
    warning: "bg-[#fff4d6] text-[#a05b16]",
    danger: "bg-[#fee4e2] text-[#b42318]",
  }
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${styles[tone]}`}>{label}</span>
}

function deadlineStatus(due: Date, nowMs = Date.now()) {
  if (Number.isNaN(due.getTime())) {
    return { status: "PENDING", label: "Deadline pending", dueLabel: "Pending" }
  }
  const diff = due.getTime() - nowMs
  const absHours = Math.max(0, Math.floor(Math.abs(diff) / 3600000))
  const absMinutes = Math.max(0, Math.floor((Math.abs(diff) % 3600000) / 60000))
  const status = diff < -4 * 3600000 ? "BREACHED" : diff < 0 ? "OVERDUE" : diff < 4 * 3600000 ? "DUE SOON" : "ON TIME"
  return {
    status,
    label: diff >= 0 ? `${absHours}h ${absMinutes}m left` : `${absHours}h ${absMinutes}m overdue`,
    dueLabel: due.toLocaleString(),
  }
}

function parseWorkflowDate(value: string) {
  const parsed = new Date(value.replace(" ", "T"))
  return Number.isNaN(parsed.getTime()) ? new Date(value) : parsed
}

function parseLocalDate(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number)
  if (!year || !month || !day) return parseWorkflowDate(dateValue)
  return new Date(year, month - 1, day)
}

function relativeDueDateLabel(dateValue: string, now = new Date()) {
  const due = parseLocalDate(dateValue)
  if (Number.isNaN(due.getTime())) return "Date pending"
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const dayDiff = Math.round((dueDay.getTime() - today.getTime()) / 86400000)
  const absoluteDays = Math.abs(dayDiff)
  if (dayDiff === 0) return "Today"
  if (dayDiff === 1) return "Tomorrow"
  if (dayDiff === -1) return "Overdue by 1 day"
  if (dayDiff < 0) return `Overdue by ${absoluteDays} days`
  return `In ${dayDiff} days`
}

function isPastLocalDate(dateValue: string, now = new Date()) {
  const due = parseLocalDate(dateValue)
  if (Number.isNaN(due.getTime())) return false
  return due.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function daysForTimeline(timeline: string) {
  if (timeline.includes("24 Hours")) return 1
  const match = timeline.match(/\d+/)
  return match ? Number(match[0]) : null
}

function addMonths(date: Date, months: number) {
  const next = new Date(date)
  next.setMonth(next.getMonth() + months)
  return next
}

function calculateSla(receivedAt: string, _risk = "", nowMs = Date.now()) {
  const parsed = new Date(receivedAt.replace(" ", "T"))
  const received = Number.isNaN(parsed.getTime()) ? new Date(receivedAt) : parsed
  const due = new Date(received.getTime() + 48 * 60 * 60 * 1000)
  return deadlineStatus(due, nowMs)
}

function calculateScreeningSla(receivedAt: string, risk: string, status: CaseRecord["status"], nowMs = Date.now(), submittedAt = "") {
  if (status === "Draft" || !submittedAt) return calculateSla(receivedAt, risk, nowMs)
  const submittedMs = parseWorkflowDate(submittedAt).getTime()
  const frozen = calculateSla(receivedAt, risk, Number.isNaN(submittedMs) ? nowMs : submittedMs)
  const late = ["OVERDUE", "BREACHED"].includes(frozen.status)
  return {
    ...frozen,
    status: late ? "SUBMITTED LATE" : "SUBMITTED ON TIME",
    label: late ? frozen.label : frozen.label.replace(" left", " remaining"),
  }
}

function workflowDeadlines(receivedAt: string, nowMs = Date.now(), assessmentStartedAt = "") {
  const received = parseWorkflowDate(receivedAt)
  const assessmentStart = assessmentStartedAt ? parseWorkflowDate(assessmentStartedAt) : null
  const assessment =
    assessmentStart && !Number.isNaN(assessmentStart.getTime())
      ? deadlineStatus(addDays(assessmentStart, 7), nowMs)
      : { status: "PENDING", label: "Starts after allocation", dueLabel: "Pending allocation" }
  if (Number.isNaN(received.getTime())) {
    return {
      screening: { status: "PENDING", label: "Deadline pending", dueLabel: "Pending" },
      assessment,
      conference: { status: "PENDING", label: "Deadline pending", dueLabel: "Pending" },
      formalReview: { status: "PENDING", label: "Deadline pending", dueLabel: "Pending" },
    }
  }
  return {
    screening: deadlineStatus(new Date(received.getTime() + 48 * 60 * 60 * 1000), nowMs),
    assessment,
    conference: deadlineStatus(addDays(received, 14), nowMs),
    formalReview: deadlineStatus(addMonths(received, 6), nowMs),
  }
}

function alertsFindFallback(alertId: string | undefined, fallback: AlertRecord) {
  return fallback.id === alertId ? fallback : fallback
}

function buildDistrictHeadRows(alerts: AlertRecord[], cases: CaseRecord[]): DistrictHeadCaseRow[] {
  const caseRows = cases.map((caseRecord) => {
    const sourceAlert = alerts.find((alert) => alert.id === caseRecord.sourceAlertId)
    const sla = calculateSla(sourceAlert?.submittedAt || caseRecord.createdAt, caseRecord.riskLevel)
    return {
      ...caseRecord,
      allocatedOfficer: caseRecord.allocatedOfficer || sourceAlert?.allocatedOfficer || "",
      deadline: sla.dueLabel,
      deadlineStatus: sla.status,
      sourceAlert,
    }
  })
  const existingIds = new Set(caseRows.map((row) => row.sourceAlertId).filter(Boolean))
  const alertRows = alerts
    .filter((alert) => ["Pending Supervisor Review", "Approved for Allocation", "Allocated to Case Officer"].includes(alert.internalStatus) && !existingIds.has(alert.id))
    .map((alert) => {
      const status: CaseRecord["status"] = alert.internalStatus === "Allocated to Case Officer" ? "Allocated" : alert.internalStatus === "Approved for Allocation" ? "Approved for Allocation" : "Pending Supervisor Review"
      const sla = calculateSla(alert.submittedAt, alert.riskLevel === "Pending" ? "Medium" : alert.riskLevel)
      return {
        id: alert.id.replace("ALT", "CASE"),
        sourceAlertId: alert.id,
        childName: alert.childName,
        sex: alert.sex,
        age: alert.age,
        district: alert.district,
        ward: alert.ward,
        concern: alert.caseCategory || alert.concern,
        riskLevel: alert.riskLevel === "Pending" ? "Medium" : alert.riskLevel,
        status,
        intakeOfficer: alert.intakeOfficer || "Intake Officer",
        allocatedOfficer: alert.allocatedOfficer,
        createdAt: alert.submittedAt,
        description: alert.description,
        deadline: sla.dueLabel,
        deadlineStatus: sla.status,
        sourceAlert: alert,
      } satisfies DistrictHeadCaseRow
    })
  return [...caseRows, ...alertRows].sort((a, b) => priorityRank(b.riskLevel) - priorityRank(a.riskLevel) || new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
}

function isCaseAllocatedToUser(row: DistrictHeadCaseRow, user?: ApiUser | null) {
  if (!user || !row.allocatedOfficer) return false
  const assignedOfficer = row.allocatedOfficer.toLowerCase()
  const fullName = `${user.first_name} ${user.last_name}`.trim()
  const initialName = user.last_name ? `${user.first_name.charAt(0)}. ${user.last_name}`.trim() : ""
  return [user.username, user.email, fullName, initialName]
    .filter(Boolean)
    .some((candidate) => assignedOfficer.includes(candidate.toLowerCase()))
}

function provinceNameForCase(row: DistrictHeadCaseRow, districts: DistrictOption[]) {
  return districts.find((district) => district.name === row.district)?.provinceName || "Not captured"
}

function districtHeadName(row: DistrictHeadCaseRow, users: ApiUser[]) {
  const districtHead = users.find((item) => item.profile.role === "DISTRICT_HEAD" && item.profile.districtName === row.district)
  return districtHead ? [districtHead.first_name, districtHead.last_name].filter(Boolean).join(" ") || districtHead.username : "Not assigned"
}

function allocatedOfficerUser(row: DistrictHeadCaseRow, users: ApiUser[]) {
  if (!row.allocatedOfficer) return undefined
  const assignedOfficer = row.allocatedOfficer.toLowerCase()
  const usernamePart = row.allocatedOfficer.split(" - ")[0]?.trim().toLowerCase()
  return users.find((item) => {
    const fullName = [item.first_name, item.last_name].filter(Boolean).join(" ").toLowerCase()
    return [item.username.toLowerCase(), item.email.toLowerCase(), fullName]
      .filter(Boolean)
      .some((candidate) => candidate === usernamePart || assignedOfficer.includes(candidate))
  })
}

function allocatedOfficerName(row: DistrictHeadCaseRow, users: ApiUser[]) {
  const officer = allocatedOfficerUser(row, users)
  if (!officer) return row.allocatedOfficer || "-"
  const fullName = [officer.first_name, officer.last_name].filter(Boolean).join(" ")
  return fullName ? `${fullName} (${officer.username})` : officer.username
}

function allocatedRowVisibleToUser(row: DistrictHeadCaseRow, user: ApiUser | null | undefined, users: ApiUser[], districts: DistrictOption[]) {
  if (!user) return false
  if (["SYS_ADMIN", "DEPUTY_DIRECTOR", "DIRECTOR", "PROGRAMME_OFFICER"].includes(user.profile.role)) return true
  if (user.profile.role === "PROVINCIAL_HEAD") {
    const district = districts.find((item) => item.name === row.district)
    return Boolean((user.profile.province && district?.province === user.profile.province) || (user.profile.provinceName && district?.provinceName === user.profile.provinceName))
  }
  if (user.profile.role === "DISTRICT_HEAD") return Boolean(user.profile.districtName && row.district === user.profile.districtName)
  return isCaseAllocatedToUser(row, user)
}

function priorityRank(risk: string) {
  const ranks: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }
  return ranks[risk.toUpperCase()] || 0
}

function tabHasCapturedData(tab: string, form: Record<string, unknown>, guardians: GuardianDraft[]) {
  if (tab === "summary") return Boolean(form.alert_id || form.intake_source || form.concern_summary || form.reporter_narrative)
  if (tab === "officer") return Boolean(form.officer_surname || form.informant_surname || form.informant_first_names)
  if (tab === "child") return Boolean(form.child_surname || form.child_first_names || form.child_age || form.child_current_location)
  if (tab === "family") return guardians.length > 0
  if (tab === "case") return Array.isArray(form.selected_categories) && form.selected_categories.length > 0
  if (tab === "background") return Boolean(form.background_organisation || form.other_background_information || form.child_story_or_reported_circumstances || (Array.isArray(form.prior_assistance) && form.prior_assistance.length > 0))
  if (tab === "plan") return Boolean(form.immediate_intervention_needed === "Yes" || form.immediate_action_plan || (Array.isArray(form.immediate_response_actions) && form.immediate_response_actions.length > 0))
  if (tab === "screening") return Boolean(form.screening_notes || form.immediate_action_plan || form.action_plan || form.risk_level)
  return false
}

function isEmptyManualPlaceholder(caseRecord: CaseRecord) {
  return !caseRecord.sourceAlertId && !caseRecord.manualMinimumComplete
}

function LegacyStatCard({ icon: Icon, value, label, tone }: { icon: ElementType; value: number; label: string; tone: string }) {
  return (
    <article className="flex min-h-[110px] items-center gap-5 rounded-md bg-white px-5 py-4 shadow-sm ring-1 ring-black/[0.04]">
      <div className={`grid h-[70px] w-[70px] shrink-0 place-items-center rounded-md text-white ${tone}`}>
        <Icon className="h-8 w-8" />
      </div>
      <div className="min-w-0">
        <div className="text-[30px] font-bold leading-none text-[#7789a6]">{value}</div>
        <div className="mt-2 max-w-[170px] text-[14px] leading-tight text-[#30528c]">{label}</div>
      </div>
    </article>
  )
}

function NewIntake({ onSave, cases, districts, wards }: { onSave: (caseRecord: CaseRecord) => void; cases: CaseRecord[]; districts: DistrictOption[]; wards: WardOption[] }) {
  const [draft, setDraft] = useState({
    childName: "",
    sex: "",
    age: "",
    district: "",
    ward: "",
    concern: "",
    riskLevel: "",
    intakeOfficer: "",
    description: "",
  })

  function save() {
    const districtCode = draft.district.slice(0, 3).toUpperCase()
    const caseNumber = `${cases.length + 1}`.padStart(3, "0")
    onSave({
      id: `CASE-2026-${districtCode}-${caseNumber}`,
      childName: draft.childName,
      sex: draft.sex,
      age: draft.age,
      district: draft.district,
      ward: draft.ward,
      concern: draft.concern,
      riskLevel: draft.riskLevel,
      status: "Draft",
      intakeOfficer: draft.intakeOfficer,
      createdAt: new Date().toISOString(),
      description: draft.description || "Manual intake captured without an originating alert.",
    })
  }

  return (
    <Panel title="New Intake" icon={FileText} action="Manual draft case">
      <FormGrid>
        <Field label="Child name"><input className={inputClass} value={draft.childName} onChange={(event) => setDraft({ ...draft, childName: event.target.value })} /></Field>
        <Field label="Sex"><select className={inputClass} value={draft.sex} onChange={(event) => setDraft({ ...draft, sex: event.target.value })}><option value="">Select sex</option><option>Female</option><option>Male</option><option>Unknown</option></select></Field>
        <Field label="Age"><input className={inputClass} value={draft.age} onChange={(event) => setDraft({ ...draft, age: event.target.value })} /></Field>
        <Field label="Concern"><select className={inputClass} value={draft.concern} onChange={(event) => setDraft({ ...draft, concern: event.target.value })}><option value="">Select concern</option>{concernCategories.map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="District"><select className={inputClass} value={draft.district} onChange={(event) => setDraft({ ...draft, district: event.target.value, ward: wards.find((ward) => ward.districtName === event.target.value)?.name || "" })}><option value="">Select district</option>{districts.map((district) => <option key={district.id}>{district.name}</option>)}</select></Field>
        <Field label="Ward"><select className={inputClass} value={draft.ward} onChange={(event) => setDraft({ ...draft, ward: event.target.value })}><option value="">Select ward</option>{wards.filter((ward) => ward.districtName === draft.district).map((ward) => <option key={ward.id}>{ward.name}</option>)}</select></Field>
        <Field label="Risk level"><select className={inputClass} value={draft.riskLevel} onChange={(event) => setDraft({ ...draft, riskLevel: event.target.value })}><option value="">Select risk</option><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></Field>
        <Field label="Intake officer"><input className={inputClass} value={draft.intakeOfficer} onChange={(event) => setDraft({ ...draft, intakeOfficer: event.target.value })} /></Field>
        <div className="md:col-span-2">
          <Field label="Case details"><textarea className={`${inputClass} min-h-[130px] py-3`} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Capture the intake narrative and immediate known facts." /></Field>
        </div>
      </FormGrid>
      <button className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-5 text-sm font-semibold text-white" onClick={save}><Plus className="h-4 w-4" /> Save draft case</button>
    </Panel>
  )
}

function Intake({ alert, refreshAlerts }: { alert: AlertRecord; refreshAlerts: () => Promise<void> }) {
  async function convert() {
    await apiPost(`/alerts/${alert.id}/convert-to-intake/`, {})
    await refreshAlerts()
  }

  return (
    <Panel title="Convert Alert to Intake" icon={FileText} action="Draft intake record">
      <div className="grid gap-5 xl:grid-cols-2">
        <Summary alert={alert} />
        <div className="space-y-4">
          <FormGrid>
            <ReadonlyField label="Linked alert ID" value={alert.id} />
            <ReadonlyField label="Temporary case reference" value={alert.id.replace("ALT", "TMP-CASE")} />
            <ReadonlyField label="Referral source" value={alert.reporterType} />
            <ReadonlyField label="Assigned intake officer" value={alert.intakeOfficer || "Assigned during intake workflow"} />
            <Field label="Household profile notes"><textarea className={`${inputClass} min-h-[100px] py-3`} placeholder="Draft household information from the alert." /></Field>
            <Field label="Child profile draft"><textarea className={`${inputClass} min-h-[100px] py-3`} placeholder="Pre-populated child details and unknown values." /></Field>
          </FormGrid>
          <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={convert}>Create draft intake</button>
        </div>
      </div>
    </Panel>
  )
}

function Screening({ alert, updateAlert, refreshAlerts }: { alert: AlertRecord; updateAlert: (id: string, changes: Partial<AlertRecord>) => void; refreshAlerts: () => Promise<void> }) {
  const duplicate = alert.childName.toLowerCase().includes("unknown") ? "Potential duplicate review required" : "No exact duplicate found"
  async function submitScreening() {
    const intake = await apiPost<{ id: number }>(`/alerts/${alert.id}/convert-to-intake/`, {})
    await apiPost(`/intakes/${intake.id}/screen/`, {
      case_category: alert.caseCategory,
      risk_level: alert.riskLevel === "Pending" ? "Medium" : alert.riskLevel,
      immediate_action_required: alert.emergency,
      immediate_action_plan: alert.actionPlan,
      initial_screening_notes: "Initial screening completed from Phase 1 screen.",
    })
    await refreshAlerts()
  }
  return (
    <Panel title="Duplicate Check, Initial Screening and Categorization" icon={FileSearch} action={alert.id}>
      <div className="grid gap-5 lg:grid-cols-3">
        <MiniCard title="Duplicate Check" value={duplicate} icon={Search} />
        <MiniCard title="Recommended Risk" value={alert.emergency ? "High / Critical" : "Medium"} icon={AlertTriangle} />
        <MiniCard title="Category" value={alert.caseCategory} icon={FolderCheck} />
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Case category"><input className={inputClass} defaultValue={alert.caseCategory} onBlur={(e) => updateAlert(alert.id, { caseCategory: e.target.value })} /></Field>
        <Field label="Risk level"><select className={inputClass} defaultValue={alert.riskLevel} onChange={(e) => updateAlert(alert.id, { riskLevel: e.target.value })}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></Field>
        <div className="md:col-span-2">
          <Field label="Immediate Action Plan if required"><textarea className={`${inputClass} min-h-[130px] py-3`} defaultValue={alert.actionPlan} onBlur={(e) => updateAlert(alert.id, { actionPlan: e.target.value })} /></Field>
        </div>
      </div>
      <button className="mt-5 rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={submitScreening}>Submit intake for supervisor review</button>
    </Panel>
  )
}

type DistrictHeadQueueMode = "submitted" | "unallocated" | "allocated"

type DistrictHeadCaseRow = CaseRecord & {
  deadline: string
  deadlineStatus: string
  sourceAlert?: AlertRecord
}

function DistrictHeadCaseQueue({
  mode,
  alerts,
  cases,
  users,
  districts,
  user,
  saveDraftCase,
  updateAlert,
  saveCalendarTasks,
  openFullIntake,
}: {
  mode: DistrictHeadQueueMode
  alerts: AlertRecord[]
  cases: CaseRecord[]
  users: ApiUser[]
  districts: DistrictOption[]
  user?: ApiUser | null
  saveDraftCase: (caseRecord: CaseRecord, options?: SaveDraftCaseOptions) => void
  updateAlert: (id: string, changes: Partial<AlertRecord>) => void
  saveCalendarTasks?: (tasks: CalendarTask[]) => Promise<void>
  openFullIntake?: (caseRecord: CaseRecord) => void
}) {
  const isDistrictHead = user?.profile.role === "DISTRICT_HEAD"
  const isProvincialHead = user?.profile.role === "PROVINCIAL_HEAD"
  const isNationalUser = Boolean(user && ["SYS_ADMIN", "DEPUTY_DIRECTOR", "DIRECTOR", "PROGRAMME_OFFICER"].includes(user.profile.role))
  const rows = buildDistrictHeadRows(alerts, cases)
  const submittedRows = rows.filter((row) => row.status === "Pending Supervisor Review")
  const unallocatedRows = rows.filter((row) => row.status === "Approved for Allocation")
  const allocatedRows = rows.filter((row) => row.status === "Allocated")
  const userAllocatedRows = allocatedRows.filter((row) => allocatedRowVisibleToUser(row, user, users, districts))
  const allocatedScopeLabel = isNationalUser ? "National allocated cases" : isProvincialHead ? "Provincial allocated cases" : isDistrictHead ? "District allocated cases" : "My allocated cases"
  const visibleRows = mode === "submitted" ? submittedRows : mode === "unallocated" ? unallocatedRows : userAllocatedRows
  const [selectedCaseId, setSelectedCaseId] = useState(visibleRows[0]?.id || rows[0]?.id || "")
  const [showDetails, setShowDetails] = useState(false)
  const [showFactBox, setShowFactBox] = useState(false)
  const [reviewNotes, setReviewNotes] = useState("")
  const [actionDialog, setActionDialog] = useState<{ title: string; detail: string } | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")
  const [riskFilter, setRiskFilter] = useState("All")
  const [districtFilter, setDistrictFilter] = useState("All")
  const [categoryFilter, setCategoryFilter] = useState("All")
  const [officerFilter, setOfficerFilter] = useState("All")
  const districtCaseWorkers = users.filter((item) => item.profile.role === "DSDO" && (!isDistrictHead || !user?.profile.districtName || item.profile.districtName === user.profile.districtName))
  const officerOptions = districtCaseWorkers.map((item) => `${item.id}|${item.username} - ${item.profile.roleLabel}`)
  const [allocatedOfficer, setAllocatedOfficer] = useState(officerOptions[0] || "")
  const selected = rows.find((row) => row.id === selectedCaseId) || visibleRows[0] || rows[0]
  const allocatedListRows = userAllocatedRows.filter((row) => {
    const search = searchTerm.trim().toLowerCase()
    const matchesSearch = !search || [row.id, row.childName, row.district, row.ward, row.concern, row.allocatedOfficer || "", allocatedOfficerName(row, users), districtHeadName(row, users), provinceNameForCase(row, districts)].some((value) => value.toLowerCase().includes(search))
    return matchesSearch
      && (statusFilter === "All" || allocatedWorkflowStatus(row) === statusFilter)
      && (riskFilter === "All" || row.riskLevel.toUpperCase() === riskFilter.toUpperCase())
      && (districtFilter === "All" || row.district === districtFilter)
      && (categoryFilter === "All" || row.concern === categoryFilter)
      && (officerFilter === "All" || (row.allocatedOfficer || "Unassigned") === officerFilter)
  })
  const allocatedDistricts = Array.from(new Set(userAllocatedRows.map((row) => row.district))).sort()
  const allocatedCategories = Array.from(new Set(userAllocatedRows.map((row) => row.concern))).sort()
  const allocatedOfficers = Array.from(new Set(userAllocatedRows.map((row) => row.allocatedOfficer || "Unassigned"))).sort()
  const allocatedStatuses = ["All", "Allocated", "Assessment In Progress", "Assessment Submitted", "Assessment Approved", "Care Plan Draft", "Care Plan Approved", "Services In Progress", "Monitoring Ongoing", "Review Due", "Closure Recommended", "Closed", "Reopened"]
  const allocatedTableHeads = [
    "Case Number",
    ...(isNationalUser ? ["Province"] : []),
    "Child Name",
    "Age",
    "Sex",
    "District",
    ...(isNationalUser || isProvincialHead ? ["District Head"] : []),
    "Ward",
    "Primary Case Category",
    "Risk Level",
    "Current Status",
    "Date Allocated",
    "Assessment Due",
    "Assessment SLA",
    "Days Since Allocation",
    "Next Action Required",
    "Assigned Officer",
    "Action",
  ]
  const queueTitle = mode === "submitted" ? "Submitted Cases" : mode === "unallocated" ? "Unallocated Cases" : "Allocated Cases"
  const queueDescription =
    mode === "submitted"
      ? "Review submitted intakes, approve them, or return them for correction."
      : mode === "unallocated"
        ? "Approved cases waiting for a case officer allocation."
        : "Cases allocated to the logged-in user."
  const emptyMessage =
    mode === "submitted"
      ? "No submitted cases waiting for review."
      : mode === "unallocated"
        ? "No approved unallocated cases."
        : "No cases have been allocated to you."
  const allocatedEmptyMessage = isNationalUser
    ? "No allocated cases found nationally."
    : isProvincialHead
      ? "No allocated cases found for this province."
      : isDistrictHead
        ? "No allocated cases found for this district."
        : "No cases have been allocated to you."
  const backLabel = mode === "submitted" ? "Back to submitted cases" : mode === "unallocated" ? "Back to unallocated cases" : "Back to allocated cases"

  useEffect(() => {
    if (!visibleRows.some((row) => row.id === selectedCaseId)) setSelectedCaseId(visibleRows[0]?.id || rows[0]?.id || "")
  }, [mode, visibleRows.length, rows.length])

  function openCase(row: DistrictHeadCaseRow) {
    setSelectedCaseId(row.id)
    setShowDetails(true)
    setShowFactBox(false)
  }

  async function updateCaseStatus(row: DistrictHeadCaseRow, status: CaseRecord["status"], officer = row.allocatedOfficer) {
    let nextOfficer = officer?.includes("|") ? officer.split("|").slice(1).join("|") : officer
    let updatedIntake: IntakeRecord | null = null
    if (row.backendIntakeId) {
      if (status === "Approved for Allocation") {
        updatedIntake = await apiPost<IntakeRecord>(`/intakes/${row.backendIntakeId}/supervisor-review/`, {
          decision: "approve",
          supervisor_notes: reviewNotes,
        })
      } else if (status === "Draft") {
        updatedIntake = await apiPost<IntakeRecord>(`/intakes/${row.backendIntakeId}/supervisor-review/`, {
          decision: "return",
          supervisor_notes: reviewNotes,
        })
      } else if (status === "Allocated") {
        const officerId = officer?.includes("|") ? officer.split("|")[0] : ""
        updatedIntake = await apiPost<IntakeRecord>(`/intakes/${row.backendIntakeId}/allocate/`, { officer_id: officerId })
        nextOfficer = updatedIntake.allocatedOfficerName || nextOfficer
      }
    }
    const updatedCase = updatedIntake ? caseFromIntake(updatedIntake, alerts, districts) : { ...row, status, allocatedOfficer: nextOfficer }
    saveDraftCase(updatedCase, { openIntake: false })
    if (row.sourceAlertId) {
      const changes: Partial<AlertRecord> =
        status === "Approved for Allocation"
          ? { status: "Approved for Allocation", internalStatus: "Approved for Allocation" }
          : status === "Allocated"
            ? { status: "Allocated to Case Officer", internalStatus: "Allocated to Case Officer", allocatedOfficer: nextOfficer }
            : { status: "Under Review", internalStatus: "Returned for Correction" }
      updateAlert(row.sourceAlertId, changes)
    }
    return updatedCase
  }

  async function approve(row: DistrictHeadCaseRow) {
    try {
      const updated = await updateCaseStatus(row, "Approved for Allocation")
      setReviewNotes("Approved. Case moved to unallocated queue.")
      setActionDialog({
        title: "Case approved successfully",
        detail: `Case ${updated.id} has been approved successfully and sent to unallocated cases.`,
      })
      setShowFactBox(false)
    } catch (error) {
      setReviewNotes(error instanceof Error ? error.message : "Could not approve case.")
    }
  }

  async function returnForCorrection(row: DistrictHeadCaseRow) {
    try {
      await updateCaseStatus(row, "Draft")
      setReviewNotes("Returned for correction.")
      setShowFactBox(false)
    } catch (error) {
      setReviewNotes(error instanceof Error ? error.message : "Could not return case for correction.")
    }
  }

  async function allocate(row: DistrictHeadCaseRow) {
    try {
      const updated = await updateCaseStatus(row, "Allocated", allocatedOfficer)
      const label = allocatedOfficer.includes("|") ? allocatedOfficer.split("|").slice(1).join("|") : allocatedOfficer
      const officerLabel = updated.allocatedOfficer || label
      setReviewNotes(`Allocated to ${label}.`)
      setActionDialog({
        title: "Case allocated successfully",
        detail: `Case ${updated.id} has been successfully allocated to ${officerLabel}.`,
      })
      setShowFactBox(false)
    } catch (error) {
      setReviewNotes(error instanceof Error ? error.message : "Could not allocate case.")
    }
  }

  if (selected && showDetails && mode === "allocated") {
    return <AllocatedCaseWorkspace row={selected} canManage={isCaseAllocatedToUser(selected, user)} onBack={() => setShowDetails(false)} onOpenFullIntake={() => openFullIntake?.(selected)} saveCalendarTasks={saveCalendarTasks} />
  }

  if (mode === "unallocated" && !isDistrictHead) {
    return <Panel title="Unallocated Cases" icon={Lock} action="District Head only"><div className="rounded-md border border-[#d8dee8] bg-white p-6 text-sm font-semibold text-[#64748b]">Only the District Head can view and allocate unallocated cases.</div></Panel>
  }

  if (selected && showDetails) {
    return (
      <div className={`grid gap-4 ${isDistrictHead && showFactBox ? "xl:grid-cols-[minmax(0,1fr)_400px]" : ""}`}>
        <Panel title="Captured Case Information" icon={ClipboardCheck} action={selected.id}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 text-sm font-semibold text-[#263747]" onClick={() => { setShowDetails(false); setShowFactBox(false) }}>{backLabel}</button>
            {isDistrictHead && <button className="grid h-11 w-11 place-items-center rounded-full border border-[#d8dee8] bg-white text-[#263747] shadow-sm" title="Fact box" onClick={() => setShowFactBox((value) => !value)}>
              <InfoIcon className="h-5 w-5" />
            </button>}
          </div>
          <CapturedCaseReadOnly row={selected} />
        </Panel>

        {isDistrictHead && showFactBox && (
          <aside className="h-fit rounded-md border border-[#d8dee8] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#edf0f4] px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-[#263747]">Fact Box</h3>
                <div className="text-sm font-semibold text-[#64748b]">{selected.id}</div>
              </div>
              <button className="grid h-9 w-9 place-items-center rounded-full border border-[#d8dee8]" onClick={() => setShowFactBox(false)} title="Close fact box">
                <InfoIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid gap-3">
                <Info label="Priority" value={selected.riskLevel} />
                <Info label="Deadline" value={selected.deadline} />
                <Info label="Status" value={selected.status} />
                <Info label="Screening completed" value={formatWorkflowDateTime(selected.screeningCompletedAt || selected.submittedForReviewAt || "")} />
                <Info label="Allocation delay" value={selected.allocationDelaySeconds == null ? selected.allocationDelayStatus || "Awaiting allocation" : formatDuration(selected.allocationDelaySeconds)} />
                <Info label="Assessment timer" value={assessmentPerformanceLabel(selected)} />
                <Info label="Child" value={`${selected.childName} | ${selected.age}`} />
                <Info label="Case type" value={selected.concern} />
                <Info label="District / Ward" value={`${selected.district} | ${selected.ward}`} />
              </div>
              {reviewNotes && <div className="rounded-md border border-[#b7e4d8] bg-[#f0fdf9] p-3 text-sm font-semibold text-[#007464]">{reviewNotes}</div>}
              {mode !== "allocated" && (
                <>
                  <Field label="Review notes"><textarea className={`${inputClass} min-h-[110px] py-3`} value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} /></Field>
                  <button className="w-full rounded-md bg-[#008c7a] px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={selected.status !== "Pending Supervisor Review"} onClick={() => approve(selected)}>Approve and send to unallocated</button>
                  <button className="w-full rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747] disabled:opacity-50" disabled={selected.status !== "Pending Supervisor Review"} onClick={() => returnForCorrection(selected)}>Return for correction</button>
                  <div className="border-t border-[#edf0f4] pt-4">
                    <Field label="Allocate to case officer"><select className={inputClass} value={allocatedOfficer} onChange={(event) => setAllocatedOfficer(event.target.value)}><option value="">Select case officer</option>{officerOptions.map((officer) => <option key={officer} value={officer}>{officer.split("|").slice(1).join("|")}</option>)}</select></Field>
                    <button className="mt-3 w-full rounded-md bg-[#263747] px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={!["Approved for Allocation", "Pending Supervisor Review"].includes(selected.status)} onClick={() => allocate(selected)}>{selected.status === "Pending Supervisor Review" ? "Approve and allocate" : "Allocate case"}</button>
                  </div>
                </>
              )}
            </div>
          </aside>
        )}
        {actionDialog && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
            <div className="w-full max-w-md rounded-md bg-white p-6 text-center shadow-xl">
              <CheckCircle2 className="mx-auto h-12 w-12 text-[#008c7a]" />
              <h3 className="mt-4 text-xl font-bold text-[#263747]">{actionDialog.title}</h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7191]">{actionDialog.detail}</p>
              <button className="mt-6 h-11 rounded-md bg-[#008c7a] px-8 font-semibold text-white hover:bg-[#007767]" onClick={() => setActionDialog(null)}>OK</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (mode === "allocated") {
    return (
      <div className="space-y-4">
        <section className="grid gap-4 md:grid-cols-3">
          <MiniCard title={allocatedScopeLabel} value={`${userAllocatedRows.length}`} icon={UserCheck} />
          <MiniCard title="High / Critical Risk" value={`${userAllocatedRows.filter((row) => ["HIGH", "CRITICAL"].includes(row.riskLevel.toUpperCase())).length}`} icon={AlertTriangle} />
          <MiniCard title="Assessment Required" value={`${userAllocatedRows.filter((row) => !row.assessmentCompletedAt).length}`} icon={FileSearch} />
        </section>

        <Panel title="Allocated Cases" icon={UserCheck} action={allocatedScopeLabel}>
          <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_repeat(5,minmax(130px,180px))]">
            <label className="flex h-11 items-center rounded-md border border-[#d8dee8] bg-white">
              <Search className="ml-3 h-4 w-4 text-[#64748b]" />
              <input className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" placeholder="Search allocated cases" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
            </label>
            <select className={inputClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>{allocatedStatuses.map((status) => <option key={status}>{status}</option>)}</select>
            <select className={inputClass} value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}>{["All", "Low", "Medium", "High", "Critical"].map((risk) => <option key={risk}>{risk}</option>)}</select>
            <select className={inputClass} value={districtFilter} onChange={(event) => setDistrictFilter(event.target.value)}><option>All</option>{allocatedDistricts.map((district) => <option key={district}>{district}</option>)}</select>
            <select className={inputClass} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option>All</option>{allocatedCategories.map((category) => <option key={category}>{category}</option>)}</select>
            <select className={inputClass} value={officerFilter} onChange={(event) => setOfficerFilter(event.target.value)}><option>All</option>{allocatedOfficers.map((officer) => <option key={officer}>{officer}</option>)}</select>
          </div>
          <div className="overflow-x-auto rounded-md border border-[#d8dee8] bg-white">
            <table className="w-full min-w-[1500px] border-collapse text-left text-sm">
              <thead className="bg-[#f8fafc] text-[#2e6fa3]">
                <tr>{allocatedTableHeads.map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr>
              </thead>
              <tbody>
                {allocatedListRows.length ? allocatedListRows.map((row) => (
                  <tr key={row.id} className="bg-white hover:bg-[#f8fafc]">
                    <td className="border-b border-[#edf0f4] px-3 py-3">
                      <button className="font-bold text-[#30528c] underline-offset-2 hover:text-[#008c7a] hover:underline" onClick={() => openCase(row)}>{row.id}</button>
                    </td>
                    {isNationalUser && <td className="border-b border-[#edf0f4] px-3 py-3">{provinceNameForCase(row, districts)}</td>}
                    <td className="border-b border-[#edf0f4] px-3 py-3">{row.childName}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{row.age}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{row.sex}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{row.district}</td>
                    {(isNationalUser || isProvincialHead) && <td className="border-b border-[#edf0f4] px-3 py-3">{districtHeadName(row, users)}</td>}
                    <td className="border-b border-[#edf0f4] px-3 py-3">{row.ward}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{row.concern}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3"><PriorityBadge risk={row.riskLevel} /></td>
                    <td className="border-b border-[#edf0f4] px-3 py-3"><span className="rounded-full bg-[#e7f6f3] px-3 py-1 text-xs font-bold text-[#007464]">{allocatedWorkflowStatus(row)}</span></td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{formatWorkflowDateTime(allocatedDate(row))}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{row.assessmentDueAt ? formatWorkflowDateTime(row.assessmentDueAt) : "Pending allocation"}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3"><StatusPill label={assessmentPerformanceLabel(row)} tone={assessmentTone(row)} /></td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{daysSince(allocatedDate(row))}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{nextAllocatedAction(row)}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{allocatedOfficerName(row, users)}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">
                      <button className="inline-flex h-9 items-center gap-2 rounded-md bg-[#008c7a] px-3 text-xs font-semibold text-white" onClick={() => openCase(row)}><Eye className="h-4 w-4" /> Open Case</button>
                    </td>
                  </tr>
                )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={allocatedTableHeads.length}>{allocatedEmptyMessage}</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-4 md:grid-cols-3">
        <MiniCard title="Submitted for Review" value={`${submittedRows.length}`} icon={ClipboardCheck} />
        <MiniCard title="Approved Unallocated" value={`${unallocatedRows.length}`} icon={Users} />
        <MiniCard title="Allocated" value={`${allocatedRows.length}`} icon={UserCheck} />
      </section>

      <Panel title={queueTitle} icon={mode === "submitted" ? ClipboardCheck : UserCheck} action="District head queue">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-[#64748b]">{queueDescription}</div>
          <div className="flex flex-wrap gap-2">
            <StatusPill label={`${submittedRows.length} submitted`} tone="review" />
            <StatusPill label={`${unallocatedRows.length} unallocated`} tone="warning" />
            <StatusPill label={`${userAllocatedRows.length} mine`} tone="draft" />
          </div>
        </div>
        <div className="overflow-x-auto rounded-md border border-[#d8dee8] bg-white">
          <table className="w-full min-w-[1280px] border-collapse text-left text-sm">
            <thead className="bg-[#f8fafc] text-[#2e6fa3]">
              <tr>{["Case No.", "Priority", "Deadline", "Allocation Wait", "Child", "District", "Case Type", "Submitted By", "Status", "Assigned Officer", "Action"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr>
            </thead>
            <tbody>
              {visibleRows.length ? visibleRows.map((row) => (
                <tr key={row.id} className={selected?.id === row.id ? "bg-[#e7f6f3]" : "bg-white hover:bg-[#f8fafc]"}>
                  <td className="border-b border-[#edf0f4] px-3 py-3">
                    <button className="font-bold text-[#30528c] underline-offset-2 hover:text-[#008c7a] hover:underline" onClick={() => openCase(row)}>{row.id}</button>
                  </td>
                  <td className="border-b border-[#edf0f4] px-3 py-3"><PriorityBadge risk={row.riskLevel} /></td>
                  <td className="border-b border-[#edf0f4] px-3 py-3"><div className="font-semibold text-[#263747]">{row.deadline}</div><div className="text-xs text-[#64748b]">{row.deadlineStatus}</div></td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{row.allocatedAt ? formatDuration(row.allocationDelaySeconds) : daysSince(row.screeningCompletedAt || row.submittedForReviewAt || row.createdAt)}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{row.childName}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{row.district}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{row.concern}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{row.intakeOfficer || "Intake Officer"}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3"><CaseStatusBadge status={row.status} /></td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{row.allocatedOfficer || "-"}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">
                    {isDistrictHead ? <button className="grid h-9 w-9 place-items-center rounded-full border border-[#d8dee8] bg-white text-[#263747]" title="Open fact box" onClick={() => { openCase(row); setShowFactBox(true) }}>
                      <InfoIcon className="h-4 w-4" />
                    </button> : <button className="inline-flex h-9 items-center gap-2 rounded-md bg-[#008c7a] px-3 text-xs font-semibold text-white" onClick={() => openCase(row)}><Eye className="h-4 w-4" /> Open</button>}
                  </td>
                </tr>
              )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={11}>{emptyMessage}</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

    </div>
  )
}

function CapturedCaseReadOnly({ row }: { row: DistrictHeadCaseRow }) {
  const alert = row.sourceAlert
  const empty = "Not captured"
  const intake = row.intakeDraft
  const opening = objectValue(intake?.opening_summary)
  const informant = objectValue(opening.informant)
  const screening = objectValue(opening.screening_draft)
  const child = objectValue(intake?.child_profile_draft)
  const household = objectValue(intake?.household_profile_draft)
  const guardians = Array.isArray(household.guardians) ? household.guardians as GuardianDraft[] : []
  const background = objectValue(intake?.background_information || row.background_information)
  const priorAssistance = Array.isArray(intake?.prior_assistance) ? intake.prior_assistance as PriorAssistanceDraft[] : row.prior_assistance || []
  const concerns = arrayValue(screening.selected_categories).length ? arrayValue(screening.selected_categories).join(", ") : alert ? alertConcerns(alert).join(", ") : row.concern
  const sourceName = alert?.protect_source_identity ? "Protected" : textValue(informant.first_names) || alert?.information_source_name || empty
  const sourceContact = alert?.protect_source_identity ? "Protected" : textValue(informant.phone) || alert?.information_source_contact || empty
  const firstValue = (...values: unknown[]) => {
    const found = values.map((value) => textValue(value).trim()).find(Boolean)
    return found || empty
  }
  const listValue = (value: unknown, fallback = empty) => {
    const items = arrayValue(value)
    return items.length ? items.join(", ") : fallback
  }
  const childName = firstValue([textValue(child.first_names), textValue(child.surname)].filter(Boolean).join(" "), row.childName)
  const primaryGuardian = guardians.find((guardian) => guardian.is_primary_caregiver === "Yes")
  const guardianSummary = guardians.length
    ? guardians.map((guardian, index) => {
        const name = [guardian.first_names, guardian.surname].filter(Boolean).join(" ") || `Guardian ${index + 1}`
        return `${index + 1}. ${guardian.guardian_type || "Guardian"} - ${name}${guardian.relationship_to_child ? ` (${guardian.relationship_to_child})` : ""}${guardian.telephone ? `, ${guardian.telephone}` : ""}${guardian.address ? `, ${guardian.address}` : ""}`
      }).join("\n")
    : empty
  const priorSummary = priorAssistance.length
    ? priorAssistance.map((item, index) => `${index + 1}. ${item.partner_name || item.district_name || item.other_district || item.source_type || "Source not captured"} - ${item.status || "Status not captured"}${item.services?.length ? `; services: ${item.services.join(", ")}` : ""}${item.service_date ? `; date: ${item.service_date}` : ""}${item.notes ? `; notes: ${item.notes}` : ""}`).join("\n")
    : empty
  const actionPlanItems = Array.isArray(screening.action_plan_items) ? screening.action_plan_items as ActionPlanItem[] : []
  const actionPlanSummary = actionPlanItems.length
    ? actionPlanItems.map((item, index) => `${index + 1}. ${item.service || "Service"} - ${item.organisation || "Organisation not captured"}; responsible: ${item.responsible || "Not captured"}; deadline: ${item.deadline || "Not captured"}; status: ${item.status || "Not captured"}${item.notes ? `; notes: ${item.notes}` : ""}`).join("\n")
    : firstValue(screening.action_plan, intake?.immediate_action_plan, row.description)
  const sections = [
    {
      title: "Alert / Intake Summary",
      fields: [
        ["Case number", row.id],
        ["Source alert", firstValue(row.sourceAlertId, opening.alert_id, "Manual intake")],
        ["Intake number", firstValue(opening.intake_number)],
        ["Date reported", firstValue(opening.date_reported, alert?.submittedAt, row.createdAt)],
        ["Intake source", firstValue(intake?.intake_source, opening.intake_source, alert?.intake_source, row.sourceAlertId ? "ALERT" : "Manual intake")],
        ["Reporting channel", firstValue(opening.reporting_channel, alert?.reporting_channel, alert?.reporterType)],
        ["District", firstValue(opening.district, row.district)],
        ["Ward", firstValue(opening.ward, row.ward)],
        ["Village / suburb", firstValue(opening.village, alert?.village_suburb)],
        ["Emergency reported", firstValue(opening.emergency_reported, alert?.emergency ? "Yes" : "No")],
        ["Immediate danger reported", firstValue(opening.immediate_danger_reported, alert?.danger?.length ? "Yes" : "No")],
        ["Concern summary", firstValue(opening.concern_summary, concerns)],
        ["Reporter narrative", firstValue(opening.reporter_narrative, alert?.description, row.description)],
        ["Attachments", firstValue(opening.attachments, alert?.attachments?.map((file) => file.name).join(", "))],
      ],
    },
    {
      title: "Officer & Informant",
      fields: [
        ["Officer surname", firstValue(opening.officer_surname)],
        ["Officer first names", firstValue(opening.officer_first_names, row.intakeOfficer)],
        ["Designation", firstValue(opening.officer_designation)],
        ["Officer district", firstValue(opening.officer_district, row.district)],
        ["Officer contact", firstValue(opening.officer_contact)],
        ["Informant surname", firstValue(informant.surname)],
        ["Informant first names", sourceName],
        ["Informant ID", firstValue(informant.id_number)],
        ["Informant sex", firstValue(informant.sex)],
        ["Informant phone", sourceContact],
        ["Informant email", firstValue(informant.email)],
        ["Relationship to child", firstValue(informant.relationship_to_child, alert?.information_source_relationship_to_child)],
        ["Organisation", firstValue(informant.organization)],
        ["Reporter type", firstValue(informant.reporter_type, alert?.reporterType)],
        ["Confidentiality requested", firstValue(informant.confidentiality, alert?.protect_source_identity ? "Yes" : "")],
      ],
    },
    {
      title: "Child Details",
      fields: [
        ["Child known", firstValue(child.known)],
        ["Surname", firstValue(child.surname)],
        ["First names", firstValue(child.first_names)],
        ["Full name", childName],
        ["ID number", firstValue(child.id_number)],
        ["Sex", firstValue(child.sex, row.sex)],
        ["Date of birth", firstValue(child.date_of_birth, alert?.date_of_birth)],
        ["Age", firstValue(child.age, row.age)],
        ["Age estimated", firstValue(child.age_is_estimated)],
        ["Birth registered", firstValue(child.birth_registered, alert?.birth_registered)],
        ["Disability status", firstValue(child.disability_status, alert?.disability)],
        ["Disability description", firstValue(child.disability_description)],
        ["Address", firstValue(child.address, alert?.home_address)],
        ["Contact details", firstValue(child.contact_details)],
        ["Home language", firstValue(child.home_language)],
        ["Current location", firstValue(child.current_location, alert?.current_location)],
        ["Safe now", firstValue(child.is_safe_now)],
        ["Caregiver present", firstValue(child.caregiver_present)],
      ],
    },
    {
      title: "Family / Guardian",
      fields: [
        ["Guardian captured", guardians.length ? "Yes" : empty],
        ["Primary caregiver", primaryGuardian ? [primaryGuardian.first_names, primaryGuardian.surname].filter(Boolean).join(" ") : firstValue(alert?.caregiver_name)],
        ["Caregiver contact", firstValue(primaryGuardian?.telephone, alert?.caregiver_contact)],
        ["Home address", firstValue(primaryGuardian?.address, alert?.home_address)],
        ["Guardian records", guardianSummary],
      ],
    },
    {
      title: "Case Type & Prosecution",
      fields: [
        ["Case categories", concerns],
        ["Primary category", firstValue(intake?.case_category, row.concern)],
        ["Category notes", firstValue(screening.case_category_notes)],
        ["Concern description", firstValue(screening.concern_description, row.description)],
        ["Perpetrator known", firstValue(screening.alleged_perpetrator_known)],
        ["Accused name", firstValue(screening.accused_name, alert?.alleged_perpetrator_name)],
        ["Relationship to child", firstValue(screening.accused_relationship_to_child, alert?.alleged_perpetrator_relationship)],
        ["Accused sex", firstValue(screening.accused_sex)],
        ["Accused address", firstValue(screening.accused_address)],
        ["Referred to police", firstValue(screening.referred_to_police)],
        ["Police reference number", firstValue(screening.police_reference_number)],
        ["Police referral date", firstValue(screening.police_referral_date)],
        ["Court appearance scheduled", firstValue(screening.court_appearance_scheduled)],
        ["Court appearance date", firstValue(screening.court_appearance_date)],
        ["Conviction determined", firstValue(screening.conviction_determined)],
        ["Conviction date", firstValue(screening.conviction_date)],
        ["Circumstances of offence", firstValue(screening.circumstances_of_offence)],
      ],
    },
    {
      title: "Background",
      fields: [
        ["Previous DSD contact", firstValue(background.previous_contact_with_dsd)],
        ["Previous law contact", firstValue(background.previous_contact_with_law)],
        ["Previous court orders", firstValue(background.previous_court_orders)],
        ["Other agency contact", firstValue(background.previous_contact_with_other_agencies)],
        ["Organisation", firstValue(screening.background_organisation)],
        ["Services already received", listValue(screening.background_services)],
        ["Other service", firstValue(screening.other_background_service)],
        ["Service notes", firstValue(background.background_service_notes)],
        ["Prior assistance records", priorSummary],
        ["Other background information", firstValue(background.other_background_information)],
        ["Child story / circumstances", firstValue(background.child_story_or_reported_circumstances)],
      ],
    },
    {
      title: "Immediate Needs / Emergency Response",
      fields: [
        ["Immediate intervention needed", firstValue(screening.immediate_intervention_needed, intake?.immediate_action_required ? "Yes" : "")],
        ["Emergency required", firstValue(screening.emergency_required)],
        ["Immediate danger", firstValue(screening.immediate_danger)],
        ["Supervisor notified", arrayValue(screening.immediate_response_actions).includes("Supervisor notified") ? "Yes" : empty],
        ["Supervisor notified at", firstValue(screening.supervisor_notified_at)],
        ["Supervisor notified by", firstValue(screening.supervisor_notified_by)],
        ["Immediate response actions", listValue(screening.immediate_response_actions)],
        ["Recommended services", listValue(screening.recommended_services)],
        ["Other recommended service", firstValue(screening.other_recommended_service)],
        ["Immediate action plan", firstValue(intake?.immediate_action_plan, screening.action_plan, row.description)],
        ["Action plan items", actionPlanSummary],
      ],
    },
    {
      title: "Screening & Submit",
      fields: [
        ["Risk level", firstValue(intake?.risk_level, row.riskLevel)],
        ["System recommended risk", firstValue(screening.system_recommended_risk, row.riskLevel)],
        ["Alert validity", firstValue(screening.alert_validity)],
        ["Vulnerability factors", listValue(screening.vulnerability_factors)],
        ["Safety concerns", firstValue(screening.safety_concerns)],
        ["Duplicate status", firstValue(screening.duplicate_status)],
        ["Duplicate decision", firstValue(screening.duplicate_decision)],
        ["Linked case ID", firstValue(screening.linked_case_id)],
        ["Duplicate notes", firstValue(screening.duplicate_notes)],
        ["Screening notes", firstValue(screening.screening_notes, intake?.initial_screening_notes)],
        ["Submission comments", firstValue(screening.submission_comments)],
        ["Screening outcome", firstValue(screening.screening_outcome)],
        ["Submitted for review at", firstValue(screening.submitted_for_review_at, row.submittedForReviewAt)],
        ["Screening completed at", firstValue(row.screeningCompletedAt, row.submittedForReviewAt)],
        ["Allocated at", firstValue(row.allocatedAt)],
        ["Allocation delay", row.allocationDelaySeconds == null ? row.allocationDelayStatus || empty : formatDuration(row.allocationDelaySeconds)],
        ["Assessment starts", firstValue(row.assessmentStartedAt, row.allocatedAt)],
        ["Assessment due", firstValue(row.assessmentDueAt)],
        ["Assessment SLA", assessmentPerformanceLabel(row)],
        ["Submission status", row.status],
        ["Deadline", row.deadline],
        ["Deadline status", row.deadlineStatus],
      ],
    },
  ]

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <MiniCard title="Priority" value={row.riskLevel} icon={AlertTriangle} />
        <MiniCard title="Deadline" value={row.deadline} icon={Clock3} />
        <MiniCard title="Current Status" value={row.status} icon={FolderCheck} />
      </div>
      {sections.map((section) => (
        <section key={section.title} className="rounded-md border border-[#d8dee8] bg-white p-4">
          <h3 className="mb-3 text-lg font-bold text-[#263747]">{section.title}</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {section.fields.map(([label, value]) => <Info key={`${section.title}-${label}`} label={label} value={value || empty} />)}
          </div>
        </section>
      ))}
    </div>
  )
}

function allocatedDate(row: DistrictHeadCaseRow) {
  return row.allocatedAt || textValue(row.intakeDraft?.allocated_at) || row.sourceAlert?.submittedAt || row.createdAt
}

function formatWorkflowDateTime(value: string) {
  const parsed = parseWorkflowDate(value)
  if (Number.isNaN(parsed.getTime())) return value || "-"
  return parsed.toLocaleString([], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

function daysSince(dateValue: string) {
  const parsed = parseWorkflowDate(dateValue)
  if (Number.isNaN(parsed.getTime())) return "-"
  const elapsedMs = Math.max(0, Date.now() - parsed.getTime())
  if (elapsedMs < 60000) return "Just now"
  if (elapsedMs < 3600000) return `${Math.floor(elapsedMs / 60000)} min`
  if (elapsedMs < 86400000) return `${Math.floor(elapsedMs / 3600000)} hrs`
  const days = Math.floor(elapsedMs / 86400000)
  return `${days} ${days === 1 ? "day" : "days"}`
}

function formatDuration(totalSeconds: number | null | undefined) {
  if (totalSeconds == null) return "-"
  const absolute = Math.abs(totalSeconds)
  const days = Math.floor(absolute / 86400)
  const hours = Math.floor((absolute % 86400) / 3600)
  const minutes = Math.floor((absolute % 3600) / 60)
  const parts = [
    days ? `${days} ${days === 1 ? "day" : "days"}` : "",
    hours ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "",
    !days && minutes ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : "",
  ].filter(Boolean)
  return parts.join(" ") || "0 minutes"
}

function assessmentPerformanceLabel(row: CaseRecord) {
  if (!row.assessmentStartedAt) return "Starts after allocation"
  const remaining = row.assessmentRemainingSeconds
  if (remaining == null) return row.assessmentSlaStatus || "Assessment active"
  if (row.assessmentCompletedAt) {
    if (remaining > 0) return `Completed ${formatDuration(remaining)} early`
    if (remaining === 0) return "Completed on time"
    return `Completed ${formatDuration(remaining)} late`
  }
  if (remaining < 0) return `Overdue by ${formatDuration(remaining)}`
  return `${formatDuration(remaining)} remaining`
}

function assessmentTone(row: CaseRecord): "draft" | "review" | "warning" | "danger" {
  const status = row.assessmentSlaStatus || ""
  if (status.includes("late") || status === "Overdue") return "danger"
  if (status === "Due soon") return "warning"
  if (status.includes("Completed") || status === "On time") return "review"
  return "draft"
}

function allocatedWorkflowStatus(row: DistrictHeadCaseRow) {
  return row.status === "Allocated" ? "Allocated" : row.status
}

function nextAllocatedAction(row: DistrictHeadCaseRow) {
  const risk = row.riskLevel.toUpperCase()
  if (risk === "CRITICAL" || risk === "HIGH") return "Start assessment and confirm safety"
  return "Start assessment"
}

type CarePlanRow = {
  problem: string
  problemArea?: string
  assistanceType: string
  goal: string
  plannedAction: string
  responsiblePerson?: string
  timeline: string
  dueDate: string
  status: string
  expectedOutcome: string
  requiresCourtRecommendation?: string
  courtRecommendation?: string
  notes?: string
}

type ServiceTrackingRow = {
  plannedAction: string
  progress: string
  status: string
  updateDate: string
  dueDate: string
  outcome: string
}

type ReferralRow = {
  linkedCarePlanItem: string
  type: string
  date: string
  followUpDate: string
  referredTo: string
  reason: string
  status: string
  outcome: string
}

type CaseDocumentRow = {
  documentType: string
  fileName: string
  notes: string
  previewUrl?: string
}

type CaseNoteRow = {
  date: string
  activityType: string
  person: string
  summary: string
  nextStep: string
  followUp: string
}

function normalizeCarePlanRow(item: Partial<CarePlanRow> & Record<string, unknown>): CarePlanRow {
  const legacyAssistanceTypes = Array.isArray(item.assistanceTypes) ? item.assistanceTypes.map(String) : Array.isArray(item.assistance_types) ? item.assistance_types.map(String) : []
  const assistanceType = `${item.assistanceType || item.assistance_type || legacyAssistanceTypes[0] || item.plannedAction || item.intervention || ""}`
  return {
    problem: `${item.problem || ""}`,
    problemArea: `${item.problemArea || item.problem_area || ""}`,
    assistanceType,
    goal: `${item.goal || ""}`,
    plannedAction: `${item.plannedAction || item.intervention || ""}`,
    responsiblePerson: `${item.responsiblePerson || item.responsible_person || "Allocated Officer"}`,
    timeline: `${item.timeline || item.deadline || "30 Days"}`,
    dueDate: `${item.dueDate || ""}`,
    status: `${item.status || "Planned"}`,
    expectedOutcome: `${item.expectedOutcome || ""}`,
    requiresCourtRecommendation: `${item.requiresCourtRecommendation || item.requires_court_recommendation || "No"}`,
    courtRecommendation: `${item.courtRecommendation || item.court_recommendation || ""}`,
    notes: `${item.notes || ""}`,
  }
}

function normalizeCarePlanRows(items: unknown[]) {
  return items.flatMap((item) => {
    const draft = draftObject(item)
    const assistanceTypes = Array.isArray(draft.assistanceTypes) ? draft.assistanceTypes.map(String) : Array.isArray(draft.assistance_types) ? draft.assistance_types.map(String) : []
    if (assistanceTypes.length <= 1) return [normalizeCarePlanRow(draft)]
    return assistanceTypes.map((assistanceType) => normalizeCarePlanRow({ ...draft, assistanceType, assistanceTypes: [assistanceType], plannedAction: assistanceType }))
  })
}

function normalizeCarePlanDraft(value: unknown, fallbackChildStory: string) {
  const draft = draftObject(value)
  return {
    childStory: `${draft.childStory || draft.child_story || fallbackChildStory}`,
    items: normalizeCarePlanRows(draftArray(draft.items)),
  }
}

function draftArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function draftObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

const legacyAssessmentSafetyKeys = [
  "childSafe",
  "immediateDanger",
  "medicalEmergency",
  "ongoingAbuse",
  "perpetratorNearby",
  "policeNeeded",
  "alternativePlacement",
  "immediateActionRequired",
  "immediateActions",
  "immediateNotes",
  "responsibleOfficer",
  "actionDate",
  "outcome",
  "currentSafetyPosition",
  "furtherUrgentAction",
  "urgentFollowUpAction",
  "urgentFollowUpDueDate",
  "urgentFollowUpResponsible",
  "urgentFollowUpNotifySupervisor",
  "urgentFollowUpSupervisorNotifiedAt",
]

function withoutLegacyAssessmentSafetyFields<T extends object>(draft: T): Partial<T> {
  const next = { ...draft } as Record<string, unknown>
  legacyAssessmentSafetyKeys.forEach((key) => delete next[key])
  return next as Partial<T>
}

function AllocatedCaseWorkspace({ row, canManage, onBack, onOpenFullIntake, saveCalendarTasks }: { row: DistrictHeadCaseRow; canManage: boolean; onBack: () => void; onOpenFullIntake: () => void; saveCalendarTasks?: (tasks: CalendarTask[]) => Promise<void> }) {
  const backendAssessmentDraft = draftObject(row.intakeDraft?.assessment_draft)
  const backendCarePlanDraft = draftObject(row.intakeDraft?.care_plan_draft)
  const [activeTab, setActiveTab] = useState("details")
  const [assessmentStep, setAssessmentStep] = useState(0)
  const [caseHealthOpen, setCaseHealthOpen] = useState(false)
  const [caseStatus, setCaseStatus] = useState("Allocated")
  const [assessmentStatus, setAssessmentStatus] = useState("Not Started")
  const [carePlanStatus, setCarePlanStatus] = useState(row.assessmentCarePlanStatus || "Draft")
  const [closureStatus, setClosureStatus] = useState(row.closureStatus || "Not Requested")
  const [supervisorReviewNotes, setSupervisorReviewNotes] = useState("")
  const [supervisorReviewDecision, setSupervisorReviewDecision] = useState("Continue case")
  const [message, setMessage] = useState("")
  const [workspaceAutosave, setWorkspaceAutosave] = useState("Autosave ready")
  const workspaceDraftKey = `ncms:allocated-workspace:${row.id}`
  const [assessment, setAssessment] = useState({
    date: new Date().toISOString().slice(0, 10),
    type: "",
    location: row.district,
    interviewed: "",
    personsInterviewed: [] as string[],
    childSeen: "",
    caregiverSeen: "",
    childStory: "",
    currentCircumstances: row.description || "",
    ambitions: "",
    observedConcerns: "",
    schoolSituation: "",
    behaviour: "",
    emotionalState: "",
    riskLevel: row.riskLevel.toUpperCase(),
    immediateActionTaken: "",
    immediateActionDescription: "",
    currentSafetyNotes: "",
    milestones: "",
    developmentAppropriateForAge: "",
    developmentMilestones: [] as string[],
    developmentConcerns: "",
    developmentConcernsNotes: "",
    developmentFunctioning: "",
    learningDevelopmentConcerns: "",
    learningDevelopmentNotes: "",
    personality: "",
    personalityTraits: [] as string[],
    personalityDescription: "",
    healthStatus: "",
    medicalCondition: "",
    disability: "",
    healthNeedsNotes: "",
    educationalStatus: "",
    currentlyInSchool: "",
    educationLevelType: "Grade",
    gradeForm: "",
    attendance: "",
    educationalConcerns: "",
    specialNeeds: "",
    disabilityIssues: "",
    basicCare: "",
    basicCareCapacity: "",
    foodSecurity: "",
    shelter: "",
    medication: "",
    meetNeeds: "",
    safetySupport: "",
    warmth: "",
    guidance: "",
    stimulation: "",
    relationship: "",
    history: "",
    currentFamilySituation: "",
    familyFunctioning: "",
    familyRelationshipsHealthy: "",
    conflictInHousehold: "",
    violenceConcern: "",
    familyDynamicsNotes: "",
    communitySupport: [] as string[],
    relationships: "",
    conflict: "",
    communityResources: "",
    socialResources: "",
    environmentalRisks: "",
    needs: [] as string[],
    findings: "",
    rootCause: "",
    protectiveFactors: "",
    risksIdentified: "",
    conclusion: "",
    decision: "",
    keyConcerns: [] as string[],
    supervisorAttentionRequired: "",
    supervisorAttentionReason: "",
    capturedFields: [] as string[],
    ...backendAssessmentDraft,
  })
  const childStorySummary = [assessment.childStory, assessment.currentCircumstances, assessment.ambitions ? `Aspiration: ${assessment.ambitions}` : ""].filter(Boolean).join("\n") || "Child circumstances, wishes, ambitions and aspirations to be confirmed from assessment."
  const backendCarePlan = normalizeCarePlanDraft(backendCarePlanDraft, childStorySummary)
  const [carePlanChildStory, setCarePlanChildStory] = useState(backendCarePlan.childStory)
  const [careRows, setCareRows] = useState<CarePlanRow[]>(backendCarePlan.items)
  const careAssistanceTypes = ["Counselling", "Court Supervision", "Family Casework", "Family Reunification", "Education Award", "Health Assistance", "Financial Assistance", "Birth Registration", "Psychosocial / Mental Health", "Disability Assistance", "Bus Warrants", "Remove from Street", "Child Justice Assistance", "Pre-trial Diversion", "HIV Stigma Support", "Other"]
  const careResponsibleOptions = ["Allocated Officer", "DSDO", "CCW", "Children's Court", "NGO Partner", "Health Facility", "Police", "Caregiver", "School", "Other"]
  const careTimelineOptions = ["7 Days", "14 Days", "30 Days", "90 Days", "Custom"]
  const carePlanPayload = () => ({
    child_story: carePlanChildStory,
    childStory: carePlanChildStory,
    items: careRows.map(normalizeCarePlanRow),
  })
  function suggestedCareAssistanceTypes() {
    const signal = [...assessment.needs, assessment.schoolSituation, assessment.educationalStatus, assessment.currentSafetyNotes, assessment.immediateActionDescription, assessment.healthStatus, assessment.specialNeeds, assessment.disabilityIssues, assessment.foodSecurity, assessment.basicCare, assessment.behaviour, assessment.emotionalState, assessment.risksIdentified].join(" ").toLowerCase()
    const suggestions = new Set<string>()
    if (signal.includes("education") || signal.includes("school") || signal.includes("dropout")) suggestions.add("Education Assistance")
    if (signal.includes("food") || signal.includes("financial") || signal.includes("poverty") || signal.includes("fees")) suggestions.add("Financial Assistance")
    if (signal.includes("health") || signal.includes("medical")) suggestions.add("Health Assistance")
    if (signal.includes("birth")) suggestions.add("Birth Registration")
    if (signal.includes("disability") || signal.includes("special needs")) suggestions.add("Disability Support")
    if (signal.includes("unsafe") || signal.includes("danger") || signal.includes("abuse") || ["HIGH", "CRITICAL"].includes(assessment.riskLevel)) {
      suggestions.add("Counselling")
      suggestions.add("Family Casework")
      suggestions.add("Court Supervision")
    }
    if (signal.includes("street")) suggestions.add("Remove from Street")
    return Array.from(suggestions)
  }
  const emptyCareDraft = (): CarePlanRow => ({
    problem: "",
    problemArea: "",
    assistanceType: suggestedCareAssistanceTypes()[0] || "",
    goal: "",
    plannedAction: "",
    responsiblePerson: "Allocated Officer",
    timeline: "30 Days",
    dueDate: addDays(new Date(), 30).toISOString().slice(0, 10),
    status: "Planned",
    expectedOutcome: "",
    requiresCourtRecommendation: "No",
    courtRecommendation: "",
    notes: "",
  })
  const [careModalIndex, setCareModalIndex] = useState<number | null>(null)
  const [careModalOpen, setCareModalOpen] = useState(false)
  const [careDraft, setCareDraft] = useState<CarePlanRow>(emptyCareDraft)
  const [serviceModalIndex, setServiceModalIndex] = useState<number | null>(null)
  const [serviceModalOpen, setServiceModalOpen] = useState(false)
  const [serviceDraft, setServiceDraft] = useState<ServiceTrackingRow>({ plannedAction: "", progress: "", status: "Pending", updateDate: new Date().toISOString().slice(0, 10), dueDate: "", outcome: "" })
  const emptyReferralDraft = (): ReferralRow => ({ linkedCarePlanItem: "", type: "Medical", date: new Date().toISOString().slice(0, 10), followUpDate: addDays(new Date(), 7).toISOString().slice(0, 10), referredTo: "", reason: "", status: "Pending", outcome: "" })
  const [referrals, setReferrals] = useState<ReferralRow[]>(draftArray(row.intakeDraft?.referrals_draft).length ? draftArray(row.intakeDraft?.referrals_draft) as ReferralRow[] : [
    { linkedCarePlanItem: "", type: "Police/VFU", date: new Date().toISOString().slice(0, 10), followUpDate: addDays(new Date(), 7).toISOString().slice(0, 10), referredTo: "", reason: "", status: "Pending", outcome: "" },
  ])
  const [referralModalIndex, setReferralModalIndex] = useState<number | null>(null)
  const [referralModalOpen, setReferralModalOpen] = useState(false)
  const [referralDraft, setReferralDraft] = useState(emptyReferralDraft)
  const [serviceRows, setServiceRows] = useState<ServiceTrackingRow[]>(draftArray(row.intakeDraft?.service_tracking_draft) as ServiceTrackingRow[])
  const [caseDocuments, setCaseDocuments] = useState<CaseDocumentRow[]>(draftArray(row.intakeDraft?.case_documents_draft).length ? draftArray(row.intakeDraft?.case_documents_draft) as CaseDocumentRow[] : [
    { documentType: "Medical Report", fileName: "", notes: "" },
  ])
  const emptyDocumentDraft = (): CaseDocumentRow => ({ documentType: "Medical Report", fileName: "", notes: "" })
  const [documentModalIndex, setDocumentModalIndex] = useState<number | null>(null)
  const [documentModalOpen, setDocumentModalOpen] = useState(false)
  const [documentDraft, setDocumentDraft] = useState<CaseDocumentRow>(emptyDocumentDraft)
  const emptyCaseNoteDraft = (): CaseNoteRow => ({ date: new Date().toISOString().slice(0, 10), activityType: "Phone Call", person: "", summary: "", nextStep: "", followUp: "" })
  const [caseNotes, setCaseNotes] = useState<CaseNoteRow[]>(draftArray(row.intakeDraft?.case_notes_draft).length ? draftArray(row.intakeDraft?.case_notes_draft) as CaseNoteRow[] : [
    { date: new Date().toISOString().slice(0, 10), activityType: "Home Visit", person: "", summary: "", nextStep: "", followUp: "" },
  ])
  const [caseNoteModalIndex, setCaseNoteModalIndex] = useState<number | null>(null)
  const [caseNoteModalOpen, setCaseNoteModalOpen] = useState(false)
  const [caseNoteDraft, setCaseNoteDraft] = useState<CaseNoteRow>(emptyCaseNoteDraft)
  const [monitoring, setMonitoring] = useState({
    visitDate: new Date().toISOString().slice(0, 10),
    visitType: "Home Visit",
    currentSituation: "",
    progress: "",
    challenges: "",
    newRisks: "",
    effectiveness: "",
    followUpNeeded: "Yes",
    nextVisitDate: "",
    progressOutcome: "No Change",
    reviewDate: new Date().toISOString().slice(0, 10),
    servicesCompleted: "",
    outstandingNeeds: "",
    progressSummary: "",
    supervisorComments: "",
    reviewDecision: "Continue Case",
    closureReason: "Goals Achieved",
    closureSummary: "",
    finalRiskLevel: row.riskLevel.toUpperCase(),
    servicesProvided: "",
    remainingConcerns: "",
    familyFeedback: "",
    recommendation: "",
  })
  const phaseTabs = [
    ["details", "Case Details"],
    ["assessment", "Assessment"],
    ["care", "Care Plan"],
    ["referrals", "Referrals"],
    ["interventions", "Interventions"],
    ["notes", "Case Notes"],
    ["attachments", "Attachments"],
    ["monitoring", "Monitoring"],
    ["review", "Case Review"],
    ["closure", "Closure"],
  ]
  const needs = ["Food Support", "Education Support", "Medical Assistance", "Birth Registration", "Counselling", "Mental Health Support", "Shelter", "Disability Support", "Legal Support", "Financial Assistance", "Family Reintegration", "Transport Support", "Other"]
  const referralTypes = ["Medical", "Police/VFU", "Place of Safety", "Counselling", "Legal", "Education", "NGO", "Birth Registration", "Food Support"]
  const referralStatuses = ["Pending", "Accepted", "Completed", "Failed"]
  const carePlanStatuses = ["Planned", "In Progress", "Completed", "Cancelled"]
  const serviceStatuses = ["Pending", "In Progress", "Ongoing", "Completed", "Failed"]
  const documentTypes = ["Medical Report", "Referral Letter", "Court Order", "Consent Form", "School Letter", "Photo", "Other"]
  const caseNoteActivityTypes = ["Home Visit", "Phone Call", "Office Visit", "School Visit", "Case Conference", "Follow-up"]
  const showDevelopmentMilestones = assessment.developmentAppropriateForAge === "Yes"
  const lifecycleDeadlines = workflowDeadlines(row.sourceAlert?.submittedAt || row.createdAt, Date.now(), row.assessmentStartedAt || row.allocatedAt || "")
  const todayIso = new Date().toISOString().slice(0, 10)
  const interventionTasks = careRows.map((item, index) => serviceRows[index] || { plannedAction: item.plannedAction, progress: "", status: "Pending", updateDate: "", dueDate: item.dueDate, outcome: "" })
  const activeInterventions = interventionTasks.filter((service) => !["Completed", "Failed"].includes(service.status))
  const overdueReferrals = referrals.filter((referral) => !["Completed", "Failed"].includes(referral.status) && referral.followUpDate && referral.followUpDate < todayIso)
  const serviceStarted = referrals.some((referral) => referral.referredTo || referral.reason || referral.status !== "Pending") || interventionTasks.some((service) => service.progress || service.outcome || service.status !== "Pending")
  const monitoringStarted = Boolean(monitoring.currentSituation || monitoring.progress || monitoring.challenges || monitoring.progressSummary || monitoring.nextVisitDate)
  const closureSubmitted = closureStatus === "Submitted" || caseStatus === "Closure Recommended"
  const workflowItems = [
    { label: "Alert Raised", state: "done" },
    { label: "Intake Completed", state: "done" },
    { label: "Screened", state: "done" },
    { label: "Allocated", state: row.status === "Allocated" ? "done" : "current" },
    { label: "Assessment", state: assessmentStatus === "Submitted" ? "done" : assessmentStatus === "In Progress" ? "current" : "pending" },
    { label: "Care Plan", state: ["Submitted", "Approved", "Approved with Comments"].includes(carePlanStatus) ? "done" : careRows.length || caseStatus === "Care Plan Draft" ? "current" : "pending" },
    { label: "Services", state: serviceStarted ? "current" : "pending" },
    { label: "Monitoring", state: monitoringStarted ? "current" : "pending" },
    { label: "Closure", state: closureSubmitted ? "done" : monitoring.closureSummary || caseStatus === "Closure Recommended" ? "current" : "pending" },
  ]
  const caseHealthItems = [
    ["Assessment overdue", row.assessmentSlaStatus === "Overdue" ? "Yes" : "No"],
    ["High risk", ["HIGH", "CRITICAL"].includes(row.riskLevel.toUpperCase()) ? "Yes" : "No"],
    ["Pending referrals", `${referrals.filter((referral) => referral.status !== "Completed").length}`],
    ["Next action", caseStatus === "Allocated" ? "Start assessment" : nextAllocatedAction(row)],
    ["Allocation delay", row.allocationDelaySeconds == null ? row.allocationDelayStatus || "Awaiting allocation" : formatDuration(row.allocationDelaySeconds)],
    ["Supervisor review", row.caseReviewStatus || "Review due every 20 days"],
    ["Days open", daysSince(row.createdAt)],
  ]
  const activityTimeline = [
    ["Alert raised", row.sourceAlert?.submittedAt || row.createdAt],
    ["Intake completed", row.createdAt],
    ["Screening completed", row.submittedForReviewAt || row.createdAt],
    ["Allocated", allocatedDate(row)],
    ["Assessment timer started", row.assessmentStartedAt || row.allocatedAt || ""],
    ["Next supervisor review due", row.caseReviewDueAt || ""],
    ...(assessmentStatus !== "Not Started" ? [["Assessment activity", row.assessmentStartedAt || row.allocatedAt || new Date().toISOString()]] : []),
    ...(careRows.length ? [["Care plan opened", new Date().toISOString()]] : []),
    ...(serviceStarted ? [["Referral/service activity", new Date().toISOString()]] : []),
    ...(monitoringStarted ? [["Monitoring updated", new Date().toISOString()]] : []),
  ]
  const capturedAssessmentFields = new Set(Array.isArray(assessment.capturedFields) ? assessment.capturedFields : [])
  const isUnselectedAssessmentValue = (value: unknown) => ["", "Select"].includes(`${value ?? ""}`.trim())
  const missingAssessmentLabels = (items: [string, unknown][]) => items.filter(([, value]) => isUnselectedAssessmentValue(value)).map(([label]) => label)
  const hasCapturedAssessmentValue = (key: keyof typeof assessment, defaultValue?: string) => {
    const value = assessment[key]
    if (Array.isArray(value)) return value.length > 0
    const text = `${value ?? ""}`.trim()
    if (isUnselectedAssessmentValue(text)) return false
    if (capturedAssessmentFields.has(`${key}`)) return true
    return defaultValue === undefined ? true : text !== defaultValue
  }
  const assessmentFieldGroups = [
    {
      label: "Visit",
      fields: [
        ["date", todayIso],
        ["type"],
        ["location", row.district],
        ["personsInterviewed"],
        ["childSeen"],
        ["caregiverSeen"],
      ] as [keyof typeof assessment, string?][],
      required: missingAssessmentLabels([
        ["Assessment date", assessment.date],
        ["Assessment type", assessment.type],
        ["Assessment location", assessment.location],
        ["Persons interviewed", assessment.personsInterviewed.length ? "Yes" : ""],
        ["Child seen", assessment.childSeen],
        ["Caregiver seen", assessment.caregiverSeen],
      ]),
    },
    {
      label: "Child",
      fields: [
        ["developmentAppropriateForAge"],
        ...(showDevelopmentMilestones ? [["developmentMilestones"], ["developmentConcerns"], ...(assessment.developmentConcerns === "Yes" ? [["developmentConcernsNotes"]] : [])] : [["developmentFunctioning"], ["learningDevelopmentConcerns"], ...(assessment.learningDevelopmentConcerns === "Yes" ? [["learningDevelopmentNotes"]] : [])]),
        ["personalityTraits"],
        ...(assessment.personalityTraits.length ? [["personalityDescription"]] : []),
        ["healthStatus"],
        ["medicalCondition"],
        ["disability"],
        ["healthNeedsNotes"],
        ["currentlyInSchool"],
        ["educationLevelType", "Grade"],
        ["gradeForm"],
        ["attendance"],
        ["educationalConcerns"],
      ] as [keyof typeof assessment, string?][],
      required: missingAssessmentLabels([
        ["Development appropriate for age", assessment.developmentAppropriateForAge],
        ...(showDevelopmentMilestones
          ? [["Development concerns", assessment.developmentConcerns]] as [string, unknown][]
          : [
            ["Development & functioning", assessment.developmentFunctioning],
            ["Learning or development concerns", assessment.learningDevelopmentConcerns],
          ] as [string, unknown][]),
        ["Child health status", assessment.healthStatus],
        ["Medical condition", assessment.medicalCondition],
        ["Disability", assessment.disability],
        ["Currently in school", assessment.currentlyInSchool],
        ["Grade / form", assessment.gradeForm],
        ["Attendance", assessment.attendance],
      ]),
    },
    {
      label: "Caregiver",
      fields: [
        ["basicCareCapacity"],
        ["foodSecurity"],
        ["shelter"],
        ["medication"],
        ["warmth"],
        ["stimulation"],
        ["guidance"],
        ["safetySupport"],
        ["relationship"],
      ] as [keyof typeof assessment, string?][],
      required: missingAssessmentLabels([
        ["Basic care capacity", assessment.basicCareCapacity],
        ["Food security", assessment.foodSecurity],
        ["Shelter", assessment.shelter],
        ["Medication access", assessment.medication],
        ["Emotional warmth", assessment.warmth],
        ["Motivation & stimulation", assessment.stimulation],
        ["Guidance & boundaries", assessment.guidance],
        ["Child safety supervision", assessment.safetySupport],
      ]),
    },
    {
      label: "Family",
      fields: [
        ["currentFamilySituation"],
        ["familyFunctioning"],
        ["familyRelationshipsHealthy"],
        ["conflictInHousehold"],
        ["violenceConcern"],
        ["familyDynamicsNotes"],
        ["communitySupport"],
      ] as [keyof typeof assessment, string?][],
      required: missingAssessmentLabels([
        ["Family functioning", assessment.familyFunctioning],
        ["Family relationships healthy", assessment.familyRelationshipsHealthy],
        ["Conflict in household", assessment.conflictInHousehold],
        ["Violence concern", assessment.violenceConcern],
      ]),
    },
    {
      label: "Safety",
      fields: [
        ["immediateActionTaken"],
        ...(assessment.immediateActionTaken === "Yes" ? [["immediateActionDescription"]] : []),
        ["currentSafetyNotes"],
      ] as [keyof typeof assessment, string?][],
      required: missingAssessmentLabels([
        ["Was immediate action taken", assessment.immediateActionTaken],
        ...(assessment.immediateActionTaken === "Yes" ? [["Immediate action taken", assessment.immediateActionDescription]] as [string, unknown][] : []),
        ["Current safety notes", assessment.currentSafetyNotes],
      ]),
    },
    {
      label: "Summary",
      fields: [
        ["keyConcerns"],
        ["conclusion"],
        ["decision"],
        ["supervisorAttentionRequired"],
        ...(assessment.supervisorAttentionRequired === "Yes" ? [["supervisorAttentionReason"]] : []),
      ] as [keyof typeof assessment, string?][],
      required: missingAssessmentLabels([
        ["Key concerns", assessment.keyConcerns.length ? "Yes" : ""],
        ["Assessment summary", assessment.conclusion],
        ["Recommendation", assessment.decision],
        ["Supervisor attention required", assessment.supervisorAttentionRequired],
      ]),
    },
  ]
  const assessmentStages = assessmentFieldGroups.map((stage) => {
    const completedFields = stage.fields.filter(([key, defaultValue]) => hasCapturedAssessmentValue(key, defaultValue)).length
    return { ...stage, completedFields, totalFields: stage.fields.length, complete: completedFields === stage.fields.length }
  })
  const completedAssessmentFields = assessmentStages.reduce((total, stage) => total + stage.completedFields, 0)
  const totalAssessmentFields = assessmentStages.reduce((total, stage) => total + stage.totalFields, 0)
  const assessmentProgress = assessmentStatus === "Submitted" ? 100 : Math.round((completedAssessmentFields / Math.max(totalAssessmentFields, 1)) * 100)
  const assessmentProgressStatus = assessmentStatus === "Submitted" ? "Submitted" : completedAssessmentFields ? "In Progress" : "Not Started"
  function caseTask(id: string, title: string, detail: string, date: string, urgent = false): CalendarTask {
    return { id: `${row.id}-${id}`, title, detail, date, urgent, source: row.id }
  }

  async function saveCaseCalendarTasks(tasks: CalendarTask[], successMessage?: string) {
    if (!tasks.length || !saveCalendarTasks) return
    try {
      await saveCalendarTasks(tasks)
      if (successMessage) setMessage(successMessage)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save case task to the calendar.")
    }
  }

  async function saveExecutionDraft(successMessage = "Case draft saved.") {
    if (!row.backendIntakeId) {
      setMessage("Draft saved locally. Backend intake record is not linked yet.")
      return
    }
    try {
      const cleanAssessment = withoutLegacyAssessmentSafetyFields(assessment)
      const updated = await apiPost<IntakeRecord>(`/intakes/${row.backendIntakeId}/save-execution-draft/`, {
        assessment: cleanAssessment,
        care_plan: carePlanPayload(),
        referrals,
        service_tracking: serviceRows,
        case_notes: caseNotes,
        case_documents: caseDocuments,
      })
      row.intakeDraft = updated
      setCarePlanStatus(updated.assessment_care_plan_status || carePlanStatus)
      setMessage(successMessage)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save case draft to the backend.")
    }
  }

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(workspaceDraftKey)
      if (!saved) return
      const draft = JSON.parse(saved) as {
        activeTab?: string
        caseStatus?: string
        assessmentStatus?: string
        carePlanStatus?: string
        closureStatus?: string
        supervisorReviewNotes?: string
        supervisorReviewDecision?: string
        assessment?: typeof assessment
        carePlanChildStory?: string
        careRows?: CarePlanRow[]
        referrals?: typeof referrals
        serviceRows?: ServiceTrackingRow[]
        caseNotes?: typeof caseNotes
        caseDocuments?: CaseDocumentRow[]
        monitoring?: typeof monitoring
        savedAt?: string
      }
      if (draft.activeTab) setActiveTab(draft.activeTab === "services" ? "referrals" : draft.activeTab)
      if (draft.caseStatus) setCaseStatus(draft.caseStatus)
      if (draft.assessmentStatus) setAssessmentStatus(draft.assessmentStatus)
      if (draft.carePlanStatus) setCarePlanStatus(draft.carePlanStatus)
      if (draft.closureStatus) setClosureStatus(draft.closureStatus)
      if (draft.supervisorReviewNotes) setSupervisorReviewNotes(draft.supervisorReviewNotes)
      if (draft.supervisorReviewDecision) setSupervisorReviewDecision(draft.supervisorReviewDecision)
      if (draft.assessment) {
        const restoredAssessment = withoutLegacyAssessmentSafetyFields(draft.assessment)
        setAssessment((current) => ({ ...current, ...restoredAssessment }))
      }
      if (draft.carePlanChildStory) setCarePlanChildStory(draft.carePlanChildStory)
      if (draft.careRows) setCareRows(normalizeCarePlanRows(draft.careRows))
      if (draft.referrals) setReferrals(draft.referrals)
      if (draft.serviceRows) setServiceRows(draft.serviceRows)
      if (draft.caseNotes) setCaseNotes(draft.caseNotes)
      if (draft.caseDocuments) setCaseDocuments(draft.caseDocuments)
      if (draft.monitoring) setMonitoring((current) => ({ ...current, ...draft.monitoring }))
      if (draft.savedAt) setWorkspaceAutosave(`Restored draft saved ${draft.savedAt}`)
    } catch {
      setWorkspaceAutosave("Autosave restore failed")
    }
  }, [workspaceDraftKey])

  useEffect(() => {
    if (!canManage) return
    setWorkspaceAutosave("Unsaved changes")
    const timeoutId = window.setTimeout(() => {
      const savedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      const cleanAssessment = withoutLegacyAssessmentSafetyFields(assessment)
      window.localStorage.setItem(workspaceDraftKey, JSON.stringify({
        activeTab,
        caseStatus,
        assessmentStatus,
        carePlanStatus,
        closureStatus,
        supervisorReviewNotes,
        supervisorReviewDecision,
        assessment: cleanAssessment,
        carePlanChildStory,
        careRows,
        referrals,
        serviceRows,
        caseNotes,
        caseDocuments,
        monitoring,
        savedAt,
      }))
      setWorkspaceAutosave(`Autosaved ${savedAt}`)
    }, 1200)
    return () => window.clearTimeout(timeoutId)
  }, [canManage, workspaceDraftKey, activeTab, caseStatus, assessmentStatus, carePlanStatus, closureStatus, supervisorReviewNotes, supervisorReviewDecision, assessment, carePlanChildStory, careRows, referrals, serviceRows, caseNotes, caseDocuments, monitoring])

  function setAssessmentValue(key: keyof typeof assessment, value: string | string[]) {
    setAssessment((current) => {
      const capturedFields = Array.isArray(current.capturedFields) ? current.capturedFields : []
      return { ...current, [key]: value, capturedFields: Array.from(new Set([...capturedFields, `${key}`])) }
    })
    if (assessmentStatus === "Not Started") setAssessmentStatus("In Progress")
    if (caseStatus === "Allocated") setCaseStatus("Assessment In Progress")
    setMessage("")
  }

  function setEducationLevelType(value: string) {
    setAssessment((current) => {
      const capturedFields = Array.isArray(current.capturedFields) ? current.capturedFields : []
      return { ...current, educationLevelType: value, gradeForm: "", capturedFields: Array.from(new Set([...capturedFields, "educationLevelType"])) }
    })
    if (assessmentStatus === "Not Started") setAssessmentStatus("In Progress")
    if (caseStatus === "Allocated") setCaseStatus("Assessment In Progress")
    setMessage("")
  }

  function toggleAssessmentArray(key: "needs" | "personsInterviewed" | "developmentMilestones" | "personalityTraits" | "communitySupport" | "keyConcerns", item: string) {
    setAssessment((current) => {
      const values = current[key]
      const capturedFields = Array.isArray(current.capturedFields) ? current.capturedFields : []
      return { ...current, [key]: values.includes(item) ? values.filter((value) => value !== item) : [...values, item], capturedFields: Array.from(new Set([...capturedFields, key])) }
    })
    if (assessmentStatus === "Not Started") setAssessmentStatus("In Progress")
  }

  function goToAssessmentStep(nextStep: number) {
    if (nextStep > assessmentStep && assessmentStages[assessmentStep].required.length) {
      setMessage(`Please complete: ${assessmentStages[assessmentStep].required.join(", ")}.`)
      return
    }
    setAssessmentStep(Math.max(0, Math.min(assessmentStages.length - 1, nextStep)))
    setMessage("")
  }

  function saveAssessment() {
    setAssessmentStatus("In Progress")
    setCaseStatus("Assessment In Progress")
    const savedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    const cleanAssessment = withoutLegacyAssessmentSafetyFields(assessment)
    window.localStorage.setItem(workspaceDraftKey, JSON.stringify({
      activeTab,
      caseStatus: "Assessment In Progress",
      assessmentStatus: "In Progress",
      carePlanStatus,
      closureStatus,
      supervisorReviewNotes,
      supervisorReviewDecision,
      assessment: cleanAssessment,
      carePlanChildStory,
      careRows,
      referrals,
      serviceRows,
      caseNotes,
      caseDocuments,
      monitoring,
      savedAt,
    }))
    setWorkspaceAutosave(`Draft saved ${savedAt}`)
    void saveExecutionDraft("Assessment draft saved to backend.")
  }

  async function submitAssessment() {
    const missingStages = assessmentStages.filter((stage) => stage.required.length)
    if (missingStages.length) {
      setAssessmentStep(Math.max(0, assessmentStages.findIndex((stage) => stage.required.length)))
      setMessage(`Please complete: ${missingStages[0].required.join(", ")}.`)
      return
    }
    setAssessmentStatus("Submitted")
    setCaseStatus("Assessment Submitted")
    let assessmentResult = assessmentPerformanceLabel(row)
    if (row.backendIntakeId) {
      try {
        const updated = await apiPost<IntakeRecord>(`/intakes/${row.backendIntakeId}/complete-assessment/`, {})
        row.assessmentCompletedAt = updated.assessment_completed_at || new Date().toISOString()
        row.assessmentStartedAt = updated.assessment_started_at || row.assessmentStartedAt
        row.assessmentDueAt = updated.assessment_due_at || row.assessmentDueAt
        row.assessmentRemainingSeconds = updated.assessmentRemainingSeconds
        row.assessmentSlaStatus = updated.assessmentSlaStatus
        assessmentResult = assessmentPerformanceLabel(row)
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Assessment submitted locally, but the completion time could not be saved.")
      }
    }
    const suggestedInterventions = suggestedCareAssistanceTypes().length ? suggestedCareAssistanceTypes() : assessment.needs
    const generated = suggestedInterventions.map((assistanceType) => ({
      problem: assistanceType,
      problemArea: "",
      assistanceType,
      goal: assistanceType === "Education Award" || assistanceType === "Education Assistance" ? "Return child to stable schooling" : `Address ${assistanceType.toLowerCase()}`,
      plannedAction: assistanceType,
      responsiblePerson: "Allocated Officer",
      timeline: ["HIGH", "CRITICAL"].includes(assessment.riskLevel) ? "7 Days" : "30 Days",
      dueDate: addDays(new Date(), ["HIGH", "CRITICAL"].includes(assessment.riskLevel) ? 7 : 30).toISOString().slice(0, 10),
      status: "Planned",
      expectedOutcome: "Need addressed and progress verified.",
      requiresCourtRecommendation: "No",
      courtRecommendation: "",
      notes: "",
    }))
    setCarePlanChildStory((current) => current || childStorySummary)
    setCareRows((current) => current.length ? current : generated)
    setWorkspaceAutosave("Assessment submitted")
    setMessage(`Assessment submitted for supervisor review. ${assessmentResult}. Identified needs are ready for care planning.`)
  }

  function updateCareRow(index: number, key: keyof CarePlanRow, value: string) {
    setCareRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item))
    if (caseStatus === "Assessment Submitted" || caseStatus === "Assessment Approved") setCaseStatus("Care Plan Draft")
  }

  function addCareRow() {
    setCareDraft(emptyCareDraft())
    setCareModalIndex(null)
    setCareModalOpen(true)
  }

  function editCareRow(index: number) {
    setCareDraft(normalizeCarePlanRow(careRows[index]))
    setCareModalIndex(index)
    setCareModalOpen(true)
  }

  function saveCareIntervention() {
    const cleanDraft = normalizeCarePlanRow(careDraft)
    if (!cleanDraft.assistanceType || !cleanDraft.plannedAction || !cleanDraft.responsiblePerson || !cleanDraft.timeline || !cleanDraft.dueDate || !cleanDraft.expectedOutcome) {
      setMessage("Complete type of assistance, assistance to be provided, responsible person, timeline, target date and expected outcome.")
      return
    }
    setCareRows((current) => careModalIndex === null ? [...current, cleanDraft] : current.map((item, index) => index === careModalIndex ? cleanDraft : item))
    setServiceRows((current) => {
      if (careModalIndex === null) return [...current, { plannedAction: cleanDraft.assistanceType || cleanDraft.plannedAction, progress: "", status: "Pending", updateDate: new Date().toISOString().slice(0, 10), dueDate: cleanDraft.dueDate, outcome: "" }]
      return current.map((item, index) => index === careModalIndex ? { ...item, plannedAction: cleanDraft.assistanceType || cleanDraft.plannedAction, dueDate: cleanDraft.dueDate } : item)
    })
    if (caseStatus === "Assessment Submitted" || caseStatus === "Assessment Approved") setCaseStatus("Care Plan Draft")
    setCareModalOpen(false)
    setCareModalIndex(null)
    setMessage(careModalIndex === null ? "Care plan item added." : "Care plan item updated.")
    if (cleanDraft.dueDate) void saveCaseCalendarTasks([
      caseTask(`care-plan-${careModalIndex ?? Date.now()}`, `Intervention due: ${cleanDraft.assistanceType || cleanDraft.plannedAction}`, `${row.id} | ${cleanDraft.expectedOutcome || "Care plan action due"}`, cleanDraft.dueDate, ["HIGH", "CRITICAL"].includes(assessment.riskLevel)),
    ], "Care plan item saved and added to the calendar.")
  }

  function removeCareRow(index: number) {
    setCareRows((current) => current.filter((_, itemIndex) => itemIndex !== index))
    setServiceRows((current) => current.filter((_, itemIndex) => itemIndex !== index))
    setMessage("Care plan item removed.")
  }

  function setCareDraftValue(key: keyof CarePlanRow, value: string) {
    setCareDraft((current) => {
      if (key === "timeline") {
        const days = daysForTimeline(value)
        return { ...current, timeline: value, dueDate: days ? addDays(new Date(), days).toISOString().slice(0, 10) : current.dueDate }
      }
      if (key === "requiresCourtRecommendation" && value === "No") {
        return { ...current, requiresCourtRecommendation: "No", courtRecommendation: "" }
      }
      if (key === "assistanceType") {
        const needsCourt = ["Court Supervision", "Child Justice Assistance", "Pre-trial Diversion"].includes(value)
        return { ...current, assistanceType: value, requiresCourtRecommendation: needsCourt ? "Yes" : current.requiresCourtRecommendation }
      }
      return { ...current, [key]: value }
    })
  }

  function saveCarePlan() {
    setCarePlanStatus("Draft")
    setCaseStatus("Care Plan Draft")
    void saveExecutionDraft("Care plan draft saved to backend.")
  }

  function submitCarePlan() {
    if (!["Submitted", "Approved"].includes(assessmentStatus)) {
      setMessage("Complete and submit the assessment before submitting the care plan.")
      return
    }
    if (!careRows.length) {
      setMessage("Create at least one care plan item before combined submission.")
      return
    }
    if (!carePlanChildStory.trim()) {
      setMessage("Capture the child's story before submitting the care plan.")
      return
    }
    void submitCombinedAssessmentCarePlan()
  }

  async function submitCombinedAssessmentCarePlan() {
    try {
      if (!row.backendIntakeId) throw new Error("This case is missing a backend intake reference.")
      const updated = await apiPost<IntakeRecord>(`/intakes/${row.backendIntakeId}/submit-assessment-care-plan/`, {
        assessment,
      care_plan: carePlanPayload(),
        referrals,
        service_tracking: serviceRows,
        case_notes: caseNotes,
        case_documents: caseDocuments,
      })
      setCarePlanStatus(updated.assessment_care_plan_status || "Submitted")
      setCaseStatus("Assessment + Care Plan Submitted")
      setMessage("Assessment and care plan submitted together for one supervisor review.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit assessment and care plan.")
    }
  }

  async function recordSupervisorReview() {
    try {
      if (!row.backendIntakeId) throw new Error("This case is missing a backend intake reference.")
      const updated = await apiPost<IntakeRecord>(`/intakes/${row.backendIntakeId}/supervisor-case-review/`, {
        decision: supervisorReviewDecision,
        notes: supervisorReviewNotes,
      })
      row.caseReviewDueAt = updated.case_review_due_at || row.caseReviewDueAt
      row.caseReviewStatus = updated.caseReviewStatus
      setMessage(`Supervisor review recorded. Next review due ${updated.case_review_due_at ? formatWorkflowDateTime(updated.case_review_due_at) : "in 20 days"}.`)
      if (supervisorReviewDecision === "Revise care plan") setActiveTab("care")
      if (updated.case_review_due_at) void saveCaseCalendarTasks([
        caseTask("next-case-review", "Case review due", `${row.id} | Formal case review`, updated.case_review_due_at.slice(0, 10), false),
      ])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not record supervisor review.")
    }
  }

  function saveMonitoringVisit() {
    setCaseStatus("Monitoring Ongoing")
    const riskMessage = monitoring.progressOutcome === "Deteriorating" || monitoring.currentSituation.toLowerCase().includes("unsafe")
      ? "Risk recalculated: supervisor attention may be required."
      : "Risk recalculated from monitoring update."
    setMessage(monitoring.nextVisitDate ? `${riskMessage} Next monitoring date added to the calendar.` : riskMessage)
    if (monitoring.nextVisitDate) void saveCaseCalendarTasks([
      caseTask("next-monitoring", "Next monitoring visit", `${row.id} | ${monitoring.visitType || "Monitoring"} | ${monitoring.progressOutcome}`, monitoring.nextVisitDate, monitoring.progressOutcome === "Deteriorating"),
    ])
  }

  function addReferral() {
    setReferralDraft(emptyReferralDraft())
    setReferralModalIndex(null)
    setReferralModalOpen(true)
    setActiveTab("referrals")
  }

  function editReferral(index: number) {
    setReferralDraft({ ...emptyReferralDraft(), ...referrals[index] })
    setReferralModalIndex(index)
    setReferralModalOpen(true)
  }

  function saveReferral() {
    setReferrals((items) => referralModalIndex === null ? [...items, referralDraft] : items.map((item, index) => index === referralModalIndex ? referralDraft : item))
    setReferralModalOpen(false)
    setReferralModalIndex(null)
    setMessage(referralModalIndex === null ? "Referral created." : "Referral updated.")
    if (referralDraft.followUpDate) void saveCaseCalendarTasks([
      caseTask(`referral-follow-up-${referralModalIndex ?? Date.now()}`, `Follow up referral: ${referralDraft.type}`, `${row.id} | ${referralDraft.referredTo || "Provider not captured"} | ${referralDraft.reason || "Referral follow-up"}`, referralDraft.followUpDate, true),
    ], "Referral saved and follow-up reminder added to the calendar.")
  }

  function removeReferral(index: number) {
    setReferrals((items) => items.filter((_, itemIndex) => itemIndex !== index))
    setMessage("Referral deleted.")
  }

  function setReferralDraftValue(key: keyof typeof referralDraft, value: string) {
    setReferralDraft((current) => ({ ...current, [key]: value }))
  }

  function updateServiceProgress(index: number) {
    const careItem = careRows[index]
    setServiceDraft(serviceRows[index] || { plannedAction: careItem?.assistanceType || careItem?.plannedAction || "", progress: "", status: "Pending", updateDate: new Date().toISOString().slice(0, 10), dueDate: careItem?.dueDate || "", outcome: "" })
    setServiceModalIndex(index)
    setServiceModalOpen(true)
  }

  function saveServiceProgress() {
    setServiceRows((items) => {
      if (serviceModalIndex === null) return [...items, serviceDraft]
      const next = careRows.map((item, index) => items[index] || { plannedAction: item.assistanceType || item.plannedAction, progress: "", status: "Pending", updateDate: "", dueDate: item.dueDate, outcome: "" })
      next[serviceModalIndex] = serviceDraft
      return next
    })
    setServiceModalOpen(false)
    setServiceModalIndex(null)
    const nextRows = careRows.map((item, index) => index === serviceModalIndex ? serviceDraft : serviceRows[index] || { plannedAction: item.assistanceType || item.plannedAction, progress: "", status: "Pending", updateDate: "", dueDate: item.dueDate, outcome: "" })
    setMessage(nextRows.length && nextRows.every((item) => ["Completed", "Failed"].includes(item.status)) ? "All intervention tasks are complete. Ready for Case Review." : "Service progress updated.")
  }

  function addCaseDocument() {
    setDocumentDraft(emptyDocumentDraft())
    setDocumentModalIndex(null)
    setDocumentModalOpen(true)
    setActiveTab("attachments")
  }

  function editCaseDocument(index: number) {
    setDocumentDraft({ ...emptyDocumentDraft(), ...caseDocuments[index] })
    setDocumentModalIndex(index)
    setDocumentModalOpen(true)
  }

  function saveCaseDocument() {
    setCaseDocuments((items) => documentModalIndex === null ? [...items, documentDraft] : items.map((item, index) => index === documentModalIndex ? documentDraft : item))
    setDocumentModalOpen(false)
    setDocumentModalIndex(null)
    setMessage(documentModalIndex === null ? "Document added." : "Document updated.")
  }

  function removeCaseDocument(index: number) {
    setCaseDocuments((items) => items.filter((_, itemIndex) => itemIndex !== index))
    setMessage("Document removed.")
  }

  function setDocumentDraftValue(key: keyof CaseDocumentRow, value: string) {
    setDocumentDraft((current) => ({ ...current, [key]: value }))
  }

  function setDocumentDraftFile(file: File | undefined) {
    if (!file) return
    setDocumentDraft((current) => ({ ...current, fileName: file.name, previewUrl: URL.createObjectURL(file) }))
  }

  function openAttachmentPreview(document: CaseDocumentRow) {
    if (!document.previewUrl) {
      setMessage("Select or re-upload a file before previewing this attachment.")
      return
    }
    window.open(document.previewUrl, "_blank", "noopener,noreferrer")
  }

  function addCaseNote() {
    setCaseNoteDraft(emptyCaseNoteDraft())
    setCaseNoteModalIndex(null)
    setCaseNoteModalOpen(true)
    setActiveTab("notes")
  }

  function editCaseNote(index: number) {
    setCaseNoteDraft({ ...emptyCaseNoteDraft(), ...caseNotes[index] })
    setCaseNoteModalIndex(index)
    setCaseNoteModalOpen(true)
  }

  function saveCaseNote() {
    setCaseNotes((items) => caseNoteModalIndex === null ? [...items, caseNoteDraft] : items.map((item, index) => index === caseNoteModalIndex ? caseNoteDraft : item))
    setCaseNoteModalOpen(false)
    setCaseNoteModalIndex(null)
    setMessage(caseNoteModalIndex === null ? "Case note added." : "Case note updated.")
    if (caseNoteDraft.followUp) void saveCaseCalendarTasks([
      caseTask(`case-note-follow-up-${caseNoteModalIndex ?? Date.now()}`, `Follow up case note: ${caseNoteDraft.activityType}`, `${row.id} | ${caseNoteDraft.nextStep || caseNoteDraft.summary || "Case note follow-up"}`, caseNoteDraft.followUp, false),
    ], "Case note saved and follow-up added to the calendar.")
  }

  function removeCaseNote(index: number) {
    setCaseNotes((items) => items.filter((_, itemIndex) => itemIndex !== index))
    setMessage("Case note removed.")
  }

  function setCaseNoteDraftValue(key: keyof CaseNoteRow, value: string) {
    setCaseNoteDraft((current) => ({ ...current, [key]: value }))
  }

  function saveClosureDraft() {
    setClosureStatus("Closure Draft")
    setMessage("Monitoring and closure draft saved.")
  }

  function submitClosure() {
    if (activeInterventions.length) {
      setMessage("Closure blocked: complete or fail all active intervention tasks before submitting closure.")
      setActiveTab("interventions")
      return
    }
    if (overdueReferrals.length) {
      setMessage("Closure blocked: resolve overdue referrals before submitting closure.")
      setActiveTab("referrals")
      return
    }
    void requestClosure()
  }

  async function requestClosure() {
    try {
      if (!row.backendIntakeId) throw new Error("This case is missing a backend intake reference.")
      const updated = await apiPost<IntakeRecord>(`/intakes/${row.backendIntakeId}/request-closure/`, {
        notes: monitoring.closureSummary || monitoring.recommendation,
      })
      setClosureStatus(updated.closure_status || "Requested")
      setCaseStatus("Closure Recommended")
      setMessage("Closure request submitted for strict supervisor approval.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not request closure.")
    }
  }

  function renderAssessmentStep() {
    if (assessmentStep === 0) {
      return (
        <SectionCard title="Assessment Visit Information">
          <p className="mb-4 text-sm font-semibold text-[#64748b]">Capture information about the assessment visit and who was interviewed.</p>
          <FormGrid>
            <Field label="Assessment Date"><input className={inputClass} type="date" value={assessment.date} onChange={(event) => setAssessmentValue("date", event.target.value)} /></Field>
            <Field label="Assessment Type"><select className={inputClass} value={assessment.type} onChange={(event) => setAssessmentValue("type", event.target.value)}><option value="">Select</option>{["Home Visit", "Institution Visit", "Office Interview", "Phone Assessment", "School Visit"].map((item) => <option key={item}>{item}</option>)}</select></Field>
            <Field label="Assessment Location"><input className={inputClass} value={assessment.location} onChange={(event) => setAssessmentValue("location", event.target.value)} /></Field>
            <Field label="Child Seen?"><select className={inputClass} value={assessment.childSeen} onChange={(event) => setAssessmentValue("childSeen", event.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
            <Field label="Caregiver Seen?"><select className={inputClass} value={assessment.caregiverSeen} onChange={(event) => setAssessmentValue("caregiverSeen", event.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
            <div className="md:col-span-2">
              <div className="mb-2 text-sm font-bold text-[#263747]">Persons Interviewed</div>
              <div className="grid gap-2 md:grid-cols-3">
                {["Child", "Mother", "Father", "Guardian", "Teacher", "Relative", "Community member"].map((item) => (
                  <label key={item} className={`flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${assessment.personsInterviewed.includes(item) ? "border-[#008c7a] bg-[#e7f6f3] text-[#007464]" : "border-[#d8dee8] bg-white text-[#263747]"}`}>
                    <input type="checkbox" className="h-4 w-4 accent-[#008c7a]" checked={assessment.personsInterviewed.includes(item)} onChange={() => toggleAssessmentArray("personsInterviewed", item)} />
                    {item}
                  </label>
                ))}
              </div>
            </div>
          </FormGrid>
        </SectionCard>
      )
    }
    if (assessmentStep === 1) {
      return (
        <SectionCard title="Child Development & Wellbeing">
          <p className="mb-4 text-sm font-semibold text-[#64748b]">Capture the child's developmental, educational, emotional and health needs.</p>
          <div className="space-y-4">
            <div className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
              <h4 className="mb-3 font-bold text-[#263747]">Development</h4>
              <Field label="Development appropriate for age?">
                <select className={inputClass} value={assessment.developmentAppropriateForAge} onChange={(event) => setAssessmentValue("developmentAppropriateForAge", event.target.value)}>
                  <option value="">Select</option>
                  <option>Yes</option>
                  <option>No</option>
                  <option>Unknown</option>
                </select>
              </Field>
              <p className="mt-2 text-sm font-semibold text-[#64748b]">Assess whether the child appears to be developing appropriately for their age.</p>
              {showDevelopmentMilestones ? (
                <>
                  <div className="mt-3">
                    <CaseTypeGroup title="Developmental Milestones" items={["Sitting", "Crawling", "Walking", "Talking", "Toilet training"]} selected={assessment.developmentMilestones} onToggle={(item) => toggleAssessmentArray("developmentMilestones", item)} />
                    <p className="mt-2 text-sm font-semibold text-[#64748b]">Select milestones achieved for younger children.</p>
                  </div>
                  <div className="mt-3">
                    <Field label="Development Concerns?">
                      <select className={inputClass} value={assessment.developmentConcerns} onChange={(event) => setAssessmentValue("developmentConcerns", event.target.value)}>
                        <option value="">Select</option>
                        <option>Yes</option>
                        <option>No</option>
                        <option>Unknown</option>
                      </select>
                    </Field>
                  </div>
                  {assessment.developmentConcerns === "Yes" && (
                    <div className="mt-3">
                      <Field label="Describe developmental concerns">
                        <textarea className={`${inputClass} min-h-[110px] py-3`} value={assessment.developmentConcernsNotes} onChange={(event) => setAssessmentValue("developmentConcernsNotes", event.target.value)} placeholder="Child not speaking for age and struggles with coordination." />
                      </Field>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="mt-3">
                    <Field label="Development & Functioning">
                      <select className={inputClass} value={assessment.developmentFunctioning} onChange={(event) => setAssessmentValue("developmentFunctioning", event.target.value)}>
                        <option value="">Select</option>
                        <option>Age Appropriate</option>
                        <option>Delayed</option>
                        <option>Unknown</option>
                      </select>
                    </Field>
                  </div>
                  <div className="mt-3">
                    <Field label="Learning or Development Concerns?">
                      <select className={inputClass} value={assessment.learningDevelopmentConcerns} onChange={(event) => setAssessmentValue("learningDevelopmentConcerns", event.target.value)}>
                        <option value="">Select</option>
                        <option>Yes</option>
                        <option>No</option>
                        <option>Unknown</option>
                      </select>
                    </Field>
                  </div>
                  {assessment.learningDevelopmentConcerns === "Yes" && (
                    <div className="mt-3">
                      <Field label="Notes">
                        <textarea className={`${inputClass} min-h-[110px] py-3`} value={assessment.learningDevelopmentNotes} onChange={(event) => setAssessmentValue("learningDevelopmentNotes", event.target.value)} placeholder="Describe concerns such as delayed learning, speech difficulties, behavioural concerns or developmental disability." />
                      </Field>
                    </div>
                  )}
                </>
              )}
              <div className="mt-3"><CaseTypeGroup title="Personality Traits" items={["Shy", "Aggressive", "Friendly", "Withdrawn", "Confident", "Fearful", "Anxious", "Social"]} selected={assessment.personalityTraits} onToggle={(item) => toggleAssessmentArray("personalityTraits", item)} /></div>
              {assessment.personalityTraits.length > 0 && (
                <div className="mt-3">
                  <Field label="Describe personality and behaviour">
                    <textarea className={`${inputClass} min-h-[110px] py-3`} value={assessment.personalityDescription} onChange={(event) => setAssessmentValue("personalityDescription", event.target.value)} placeholder="Describe how these traits present during daily life, school, home or interviews." />
                  </Field>
                </div>
              )}
            </div>
            <div className="rounded-md border border-[#d8dee8] bg-white p-4">
              <h4 className="mb-3 font-bold text-[#263747]">Health</h4>
              <div className="space-y-3">
                <Field label="Child Health Status"><select className={inputClass} value={assessment.healthStatus} onChange={(event) => setAssessmentValue("healthStatus", event.target.value)}><option value="">Select</option>{["Good", "Fair", "Poor", "Critical"].map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field label="Medical Condition?"><select className={inputClass} value={assessment.medicalCondition} onChange={(event) => setAssessmentValue("medicalCondition", event.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                <Field label="Disability?"><select className={inputClass} value={assessment.disability} onChange={(event) => setAssessmentValue("disability", event.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                <Field label="Health Needs Notes"><textarea className={`${inputClass} min-h-[110px] py-3`} value={assessment.healthNeedsNotes} onChange={(event) => setAssessmentValue("healthNeedsNotes", event.target.value)} placeholder="Describe medical concerns, disabilities, medication needs or nutrition concerns." /></Field>
              </div>
            </div>
            <div className="rounded-md border border-[#d8dee8] bg-white p-4">
              <h4 className="mb-3 font-bold text-[#263747]">Education</h4>
              <div className="space-y-3">
                <Field label="Currently in School?"><select className={inputClass} value={assessment.currentlyInSchool} onChange={(event) => setAssessmentValue("currentlyInSchool", event.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                <div>
                  <div className="mb-2 text-sm font-bold text-[#263747]">Education Level</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {["Grade", "Form"].map((item) => (
                      <label key={item} className={`flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${assessment.educationLevelType === item ? "border-[#008c7a] bg-[#e7f6f3] text-[#007464]" : "border-[#d8dee8] bg-white text-[#263747]"}`}>
                        <input type="radio" className="h-4 w-4 accent-[#008c7a]" checked={assessment.educationLevelType === item} onChange={() => setEducationLevelType(item)} />
                        {item}
                      </label>
                    ))}
                  </div>
                </div>
                <Field label={assessment.educationLevelType === "Form" ? "Select Form" : "Select Grade"}>
                  <select className={inputClass} value={assessment.gradeForm} onChange={(event) => setAssessmentValue("gradeForm", event.target.value)}>
                    <option value="">Select</option>
                    {(assessment.educationLevelType === "Form" ? ["Form 1", "Form 2", "Form 3", "Form 4", "Form 5", "Form 6"] : ["ECD A", "ECD B", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7"]).map((item) => <option key={item}>{item}</option>)}
                  </select>
                </Field>
                <Field label="Attendance"><select className={inputClass} value={assessment.attendance} onChange={(event) => setAssessmentValue("attendance", event.target.value)}><option value="">Select</option>{["Regular", "Irregular", "Dropped Out", "Unknown"].map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field label="Educational Concerns"><textarea className={`${inputClass} min-h-[110px] py-3`} value={assessment.educationalConcerns} onChange={(event) => setAssessmentValue("educationalConcerns", event.target.value)} placeholder="Describe school attendance, performance, barriers or educational support needed." /></Field>
              </div>
            </div>
          </div>
        </SectionCard>
      )
    }
    if (assessmentStep === 2) {
      return (
        <SectionCard title="Caregiver Capacity">
          <p className="mb-4 text-sm font-semibold text-[#64748b]">Assess the caregiver's ability to meet the child's needs.</p>
          <div className="flex w-full flex-col gap-4">
            <div className="w-full rounded-md border border-[#d8dee8] bg-white p-4">
              <h4 className="mb-3 font-bold text-[#263747]">Basic Care</h4>
              <div className="space-y-3">
                <Field label="Basic Care Capacity"><select className={inputClass} value={assessment.basicCareCapacity} onChange={(event) => setAssessmentValue("basicCareCapacity", event.target.value)}><option value="">Select</option>{["Excellent", "Good", "Fair", "Poor", "Critical"].map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field label="Food Security"><select className={inputClass} value={assessment.foodSecurity} onChange={(event) => setAssessmentValue("foodSecurity", event.target.value)}><option value="">Select</option>{["Adequate", "Limited", "Severe Concern"].map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field label="Shelter"><select className={inputClass} value={assessment.shelter} onChange={(event) => setAssessmentValue("shelter", event.target.value)}><option value="">Select</option>{["Safe", "Fair", "Unsafe"].map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field label="Medication Access"><select className={inputClass} value={assessment.medication} onChange={(event) => setAssessmentValue("medication", event.target.value)}><option value="">Select</option>{["Available", "Limited", "Not Available", "N/A"].map((item) => <option key={item}>{item}</option>)}</select></Field>
              </div>
            </div>
            <div className="w-full rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
              <h4 className="mb-3 font-bold text-[#263747]">Parenting & Emotional Care</h4>
              <div className="space-y-3">
                {[["Emotional Warmth", "warmth"], ["Motivation & Stimulation", "stimulation"], ["Guidance & Boundaries", "guidance"], ["Child Safety Supervision", "safetySupport"]].map(([label, key]) => <Field key={key} label={label}><select className={inputClass} value={`${assessment[key as keyof typeof assessment]}`} onChange={(event) => setAssessmentValue(key as keyof typeof assessment, event.target.value)}><option value="">Select</option>{["1", "2", "3", "4", "5"].map((item) => <option key={item}>{item}</option>)}</select></Field>)}
              </div>
            </div>
            <div className="w-full rounded-md border border-[#d8dee8] bg-white p-4">
              <h4 className="mb-3 font-bold text-[#263747]">Significant Relationships</h4>
              <Field label="Relationship Notes"><textarea className={`${inputClass} min-h-[180px] py-3`} value={assessment.relationship} onChange={(event) => setAssessmentValue("relationship", event.target.value)} placeholder="Describe child's relationships with family members or trusted adults." /></Field>
            </div>
          </div>
        </SectionCard>
      )
    }
    if (assessmentStep === 3) {
      return (
        <SectionCard title="Family & Environment">
          <p className="mb-4 text-sm font-semibold text-[#64748b]">Capture environmental and family factors affecting the child.</p>
          <FormGrid>
            <div className="md:col-span-2"><Field label="Current Family Situation"><textarea className={`${inputClass} min-h-[110px] py-3`} value={assessment.currentFamilySituation} onChange={(event) => setAssessmentValue("currentFamilySituation", event.target.value)} placeholder="Describe household circumstances and major family issues." /></Field></div>
            <Field label="Family Functioning"><select className={inputClass} value={assessment.familyFunctioning} onChange={(event) => setAssessmentValue("familyFunctioning", event.target.value)}><option value="">Select</option>{["Stable", "Moderate Concern", "High Concern"].map((item) => <option key={item}>{item}</option>)}</select></Field>
            <Field label="Family Relationships Healthy?"><select className={inputClass} value={assessment.familyRelationshipsHealthy} onChange={(event) => setAssessmentValue("familyRelationshipsHealthy", event.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
            <Field label="Conflict in Household?"><select className={inputClass} value={assessment.conflictInHousehold} onChange={(event) => setAssessmentValue("conflictInHousehold", event.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
            <Field label="Violence Concern?"><select className={inputClass} value={assessment.violenceConcern} onChange={(event) => setAssessmentValue("violenceConcern", event.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
            <div className="md:col-span-2"><Field label="Family Dynamics Notes"><textarea className={`${inputClass} min-h-[100px] py-3`} value={assessment.familyDynamicsNotes} onChange={(event) => setAssessmentValue("familyDynamicsNotes", event.target.value)} placeholder="Describe arguments, relationships and household interactions." /></Field></div>
          </FormGrid>
          <div className="mt-4"><CaseTypeGroup title="Community Support" items={["School Support", "NGO Support", "Religious Support", "Community Leader", "Extended Family"]} selected={assessment.communitySupport} onToggle={(item) => toggleAssessmentArray("communitySupport", item)} /></div>
        </SectionCard>
      )
    }
    if (assessmentStep === 4) {
      return (
        <SectionCard title="Safety">
          <FormGrid>
            <Field label="Was immediate action taken?">
              <select className={inputClass} value={assessment.immediateActionTaken} onChange={(event) => setAssessmentValue("immediateActionTaken", event.target.value)}>
                <option value="">Select</option>
                <option>Yes</option>
                <option>No</option>
              </select>
            </Field>
            {assessment.immediateActionTaken === "Yes" && (
              <div className="md:col-span-2">
                <Field label="Immediate Action Taken">
                  <textarea className={`${inputClass} min-h-[110px] py-3`} value={assessment.immediateActionDescription} onChange={(event) => setAssessmentValue("immediateActionDescription", event.target.value)} />
                </Field>
              </div>
            )}
            <div className="md:col-span-2">
              <Field label="Current Safety Notes">
                <textarea className={`${inputClass} min-h-[130px] py-3`} value={assessment.currentSafetyNotes} onChange={(event) => setAssessmentValue("currentSafetyNotes", event.target.value)} placeholder="Describe current protection concerns identified during assessment" />
              </Field>
            </div>
          </FormGrid>
        </SectionCard>
      )
    }
    return (
      <SectionCard title="Summary & Decision">
        <CaseTypeGroup title="Key Concerns" items={["Neglect", "Abuse", "Poverty", "School Dropout", "Health", "Violence"]} selected={assessment.keyConcerns} onToggle={(item) => toggleAssessmentArray("keyConcerns", item)} />
        <div className="mt-4 space-y-4">
          <Field label="Assessment Summary"><textarea className={`${inputClass} min-h-[150px] py-3`} value={assessment.conclusion} onChange={(event) => setAssessmentValue("conclusion", event.target.value)} placeholder="Provide a professional summary of findings and major concerns identified." /></Field>
          <Field label="Recommendation"><select className={inputClass} value={assessment.decision} onChange={(event) => setAssessmentValue("decision", event.target.value)}><option value="">Select</option>{["Proceed to Care Plan", "Emergency Intervention", "Refer for Immediate Services", "Alternative Placement", "Close Case"].map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="Supervisor Attention Required?"><select className={inputClass} value={assessment.supervisorAttentionRequired} onChange={(event) => setAssessmentValue("supervisorAttentionRequired", event.target.value)}><option value="">Select</option><option>No</option><option>Yes</option></select></Field>
          {assessment.supervisorAttentionRequired === "Yes" && <Field label="Reason"><textarea className={`${inputClass} min-h-[90px] py-3`} value={assessment.supervisorAttentionReason} onChange={(event) => setAssessmentValue("supervisorAttentionReason", event.target.value)} /></Field>}
        </div>
      </SectionCard>
    )
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Case Workspace"
        icon={BriefcaseBusiness}
        action={(
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-semibold text-[#475569]">{row.id}</span>
            <button
              className={`grid h-8 w-8 place-items-center rounded-full border text-[#263747] shadow-sm hover:border-[#008c7a] hover:text-[#008c7a] ${caseHealthOpen ? "border-[#008c7a] bg-[#e7f6f3]" : "border-[#d8dee8] bg-white"}`}
              title={caseHealthOpen ? "Hide case health" : "Show case health"}
              onClick={() => setCaseHealthOpen((value) => !value)}
            >
              <InfoIcon className="h-4 w-4" />
            </button>
          </div>
        )}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 text-sm font-semibold text-[#263747]" onClick={onBack}>Back to allocated cases</button>
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <>
                <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={addCaseNote}>Add Case Note</button>
                <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={addReferral}>Create Referral</button>
                <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]">Print Case Summary</button>
              </>
            )}
            <button className="rounded-md bg-[#008c7a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#007767]" onClick={onOpenFullIntake}>Open Full Intake</button>
          </div>
        </div>
        {!canManage && (
          <div className="mb-4 rounded-md border border-[#d8dee8] bg-[#f8fafc] p-3 text-sm font-semibold text-[#475569]">
            Supervisor view only. The allocated officer is responsible for case actions.
          </div>
        )}
        {canManage && (
          <div className="mb-4 rounded-md border border-[#b7e4d8] bg-[#f0fdf9] p-3 text-sm font-semibold text-[#007464]">
            {workspaceAutosave}
          </div>
        )}
        <div className={`grid gap-4 ${caseHealthOpen ? "xl:grid-cols-[minmax(0,1fr)_320px_320px]" : "xl:grid-cols-[minmax(0,1fr)_320px]"}`}>
          <section className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h1 className="text-[22px] font-bold text-[#263747]">{row.id}</h1>
              <PriorityBadge risk={row.riskLevel} />
              <span className="rounded-full bg-[#e7f6f3] px-3 py-1 text-xs font-bold text-[#007464]">{caseStatus}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Info label="Child" value={row.childName} />
              <Info label="Age / Sex" value={`${row.age} / ${row.sex}`} />
              <Info label="District / Ward" value={`${row.district} / ${row.ward}`} />
              <Info label="Referral Received" value={row.sourceAlert?.submittedAt || row.createdAt} />
              <Info label="Screening Completed" value={formatWorkflowDateTime(row.screeningCompletedAt || row.submittedForReviewAt || "")} />
              <Info label="Allocated" value={formatWorkflowDateTime(allocatedDate(row))} />
              <Info label="Assessment Due" value={row.assessmentDueAt ? formatWorkflowDateTime(row.assessmentDueAt) : lifecycleDeadlines.assessment.dueLabel} />
              <Info label="Assessment Timer" value={assessmentPerformanceLabel(row)} />
              <Info label="Case Conference Due" value={lifecycleDeadlines.conference.dueLabel} />
              <Info label="Assigned Officer" value={row.allocatedOfficer || "Not assigned"} />
              <Info label="Case Category" value={row.concern} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusPill label={row.assessmentSlaStatus || lifecycleDeadlines.assessment.status} tone={assessmentTone(row)} />
              <StatusPill label={row.allocationDelayStatus || "Allocation timing captured"} tone={row.allocationDelayStatus === "Allocation delayed" ? "warning" : "review"} />
            </div>
          </section>
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <div className="text-xs font-bold uppercase text-[#64748b]">Workflow Progress</div>
            <div className="mt-3 space-y-2">
              {workflowItems.map((item) => (
                <div key={item.label} className={`flex items-center gap-2 text-sm font-semibold ${item.state === "pending" ? "text-[#64748b]" : "text-[#50617a]"}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${item.state === "done" ? "bg-[#008c7a]" : item.state === "current" ? "bg-[#d4a72c]" : "bg-[#cbd5e1]"}`} />
                  {item.label}
                </div>
              ))}
            </div>
          </section>
          {caseHealthOpen && (
            <section className="rounded-md border border-[#d8dee8] bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase text-[#64748b]">Case Health</div>
                  <div className="mt-1 text-sm font-semibold text-[#263747]">{row.id}</div>
                </div>
                <button className="grid h-8 w-8 place-items-center rounded-full border border-[#d8dee8] text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]" title="Hide case health" onClick={() => setCaseHealthOpen(false)}>
                  <InfoIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-2">
                {caseHealthItems.map(([label, value]) => <Info key={label} label={label} value={value} />)}
              </div>
            </section>
          )}
        </div>
        <div className="mt-4 rounded-md border border-[#d8dee8] bg-white p-4">
          <div className="text-xs font-bold uppercase text-[#64748b]">Case Timeline</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {activityTimeline.map(([label, value]) => <Info key={label} label={label} value={formatWorkflowDateTime(value)} />)}
          </div>
        </div>
        {message && <div className="mt-4 rounded-md border border-[#b7e4d8] bg-[#f0fdf9] p-3 text-sm font-semibold text-[#007464]">{message}</div>}
      </Panel>

      <Panel title="Case Lifecycle" icon={FolderCheck}>
        <div className="mb-5 flex gap-2 overflow-x-auto border-b border-[#d8dee8]">
          {phaseTabs.map(([key, label]) => (
            <button key={key} className={`relative min-h-12 shrink-0 px-2 text-xs font-bold uppercase sm:px-3 sm:text-sm ${activeTab === key ? "text-[#008c7a]" : "text-[#50617a] hover:text-[#008c7a]"}`} onClick={() => setActiveTab(key)}>
              {label}
              {activeTab === key && <span className="absolute bottom-[-1px] left-0 h-1 w-full rounded-t bg-[#008c7a]" />}
            </button>
          ))}
        </div>

        <fieldset disabled={!canManage} className={`min-w-0 ${!canManage ? "opacity-90" : ""}`}>
        {activeTab === "details" && <AllocatedCaseDetails row={row} />}

        {activeTab === "assessment" && (
          <div className="space-y-5">
            <section className="rounded-md border border-[#d8dee8] bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold text-[#263747]">Assessment</h2>
                  <p className="mt-1 text-sm font-semibold text-[#64748b]">Guided professional assessment workflow</p>
                </div>
                <div className="grid gap-2 text-sm font-bold text-[#263747] sm:grid-cols-3">
                  <span>Assessment Status: {assessmentProgressStatus}</span>
                  <span>Assessment Due: {lifecycleDeadlines.assessment.dueLabel}</span>
                </div>
              </div>
            </section>
            <section className="rounded-md border border-[#d8dee8] bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-bold uppercase text-[#64748b]">Assessment Progress</div>
                <div className="text-sm font-bold text-[#008c7a]">{assessmentProgress}%</div>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-[#e2e8f0]">
                <div className="h-full bg-[#008c7a]" style={{ width: `${assessmentProgress}%` }} />
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                {assessmentStages.map((stage, index) => (
                  <button key={stage.label} className={`rounded-md border px-3 py-3 text-left text-sm font-bold ${assessmentStep === index ? "border-[#2e6fa3] bg-[#eef8ff] text-[#1f4f7a]" : stage.required.length ? "border-[#f4b4ac] bg-[#fff7f5] text-[#b42318]" : stage.complete ? "border-[#008c7a] bg-[#e7f6f3] text-[#007464]" : "border-[#d8dee8] bg-white text-[#50617a]"}`} onClick={() => goToAssessmentStep(index)}>
                    {stage.required.length ? "⚠" : stage.complete ? "✓" : assessmentStep === index ? "●" : "○"} {index + 1}. {stage.label}
                  </button>
                ))}
              </div>
            </section>
            {renderAssessmentStep()}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#d8dee8] bg-white p-3">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={saveAssessment}>Save Draft</button>
              <div className="flex flex-wrap gap-2">
                <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747] disabled:opacity-50" disabled={assessmentStep === 0} onClick={() => goToAssessmentStep(assessmentStep - 1)}>Previous</button>
                {assessmentStep < assessmentStages.length - 1 ? <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={() => goToAssessmentStep(assessmentStep + 1)}>Next</button> : <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={submitAssessment}>Submit Assessment</button>}
              </div>
            </div>
          </div>
        )}

        {activeTab === "care" && (
          <div className="min-w-0 space-y-5 overflow-hidden">
            <div className="grid min-w-0 gap-4 md:grid-cols-3">
              <MiniCard title="Care Plan Status" value={carePlanStatus} icon={FolderCheck} />
              <MiniCard title="Care Plan Items" value={`${careRows.length}`} icon={CheckSquare} />
              <MiniCard title="Assessment Gate" value={assessmentStatus} icon={FileSearch} />
            </div>
            <SectionCard title="Care Plan">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[#64748b]">Capture the child's story once, then add each intervention as its own trackable action.</p>
                <button className="rounded-md bg-[#008c7a] px-4 py-2 text-sm font-semibold text-white" onClick={addCareRow}>+ Add Intervention</button>
              </div>
              <div className="mb-4 rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
                <Field label="Child's Story">
                  <textarea className={`${inputClass} min-h-[130px] bg-white py-3`} value={carePlanChildStory} onChange={(event) => setCarePlanChildStory(event.target.value)} placeholder="Capture the child's circumstances, wishes, ambitions and aspirations once for this care plan." />
                </Field>
              </div>
              <div className="w-full max-w-full overflow-x-auto rounded-md border border-[#d8dee8]">
                <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                  <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Type of Assistance", "Responsible", "Timeline", "Target Date", "Status", "Expected Outcome", "Action"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
                  <tbody>{careRows.length ? careRows.map((item, index) => (
                    <tr key={`${item.assistanceType}-${index}`} className="bg-white">
                      <td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]">{item.assistanceType || "-"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{item.responsiblePerson || "-"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{item.timeline || "-"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{item.dueDate || item.timeline || "-"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3"><StatusPill label={item.status || "Planned"} tone="review" /></td>
                      <td className="max-w-[260px] border-b border-[#edf0f4] px-3 py-3">{item.expectedOutcome || "-"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">
                        <div className="flex items-center gap-2">
                          <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#2e6fa3] hover:border-[#008c7a] hover:text-[#008c7a]" title="Edit care plan item" onClick={() => editCareRow(index)}>
                            <PencilLine className="h-4 w-4" />
                          </button>
                          <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#f4b4ac] bg-white text-[#b42318] hover:bg-[#fff7f5]" title="Remove care plan item" onClick={() => removeCareRow(index)}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={7}>No interventions yet. Add one intervention item at a time.</td></tr>}</tbody>
                </table>
              </div>
            </SectionCard>
            <SectionCard title="Combined Assessment & Care Plan Approval">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <StatusPill label={carePlanStatus} tone="review" />
                  <div className="text-sm font-semibold text-[#64748b]">One supervisor review covers both the assessment findings and care plan.</div>
                </div>
                <div className="flex gap-2">
                  <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={saveCarePlan}>Save Draft</button>
                  <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={submitCarePlan}>Submit Assessment + Care Plan</button>
                </div>
              </div>
            </SectionCard>
          </div>
        )}

        {activeTab === "referrals" && (
          <div className="space-y-5">
            <SectionCard title="Referrals">
              <div className="mb-3 flex justify-end">
                <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={addReferral}><Plus className="h-4 w-4" /> Create Referral</button>
              </div>
              <div className="w-full max-w-full overflow-x-auto rounded-md border border-[#d8dee8]">
                <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                  <thead className="bg-[#f8fafc] text-[#2e6fa3]">
                    <tr>{["Linked Care Plan Item", "Referral Type", "Referred To", "Referral Date", "Follow-up Date", "Reason", "Status", "Outcome / Feedback", "Action"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr>
                  </thead>
                  <tbody>{referrals.length ? referrals.map((referral, index) => (
                    <tr key={`${referral.type}-${referral.date}-${index}`} className="bg-white">
                      <td className="border-b border-[#edf0f4] px-3 py-3">{referral.linkedCarePlanItem || "Not linked"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]">{referral.type || "-"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{referral.referredTo || "Not captured"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{referral.date || "-"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{referral.followUpDate || "-"}</td>
                      <td className="max-w-[220px] border-b border-[#edf0f4] px-3 py-3">{referral.reason || "No reason captured"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3"><StatusPill label={referral.status || "Pending"} tone={referral.status === "Completed" ? "review" : "warning"} /></td>
                      <td className="max-w-[220px] border-b border-[#edf0f4] px-3 py-3">{referral.outcome || "No feedback captured"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">
                        <div className="flex items-center gap-2">
                          <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#2e6fa3] hover:border-[#008c7a] hover:text-[#008c7a]" title="Edit referral" onClick={() => editReferral(index)}>
                            <PencilLine className="h-4 w-4" />
                          </button>
                          <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#f4b4ac] bg-white text-[#b42318] hover:bg-[#fff7f5]" title="Delete referral" onClick={() => removeReferral(index)}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={9}>No referrals captured yet. Create a referral to add it to this table.</td></tr>}</tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        )}

        {activeTab === "interventions" && (
          <div className="space-y-5">
            <SectionCard title="Service Tracking">
              <div className="w-full max-w-full overflow-x-auto rounded-md border border-[#d8dee8]">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Intervention", "Due Date", "Progress", "Status", "Action"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
                  <tbody>{careRows.length ? careRows.map((item, index) => {
                    const service = serviceRows[index] || { plannedAction: item.assistanceType || item.plannedAction, progress: "", status: "Pending", updateDate: "", dueDate: item.dueDate, outcome: "" }
                    return <tr key={`${item.assistanceType}-${index}`}><td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]">{item.assistanceType || item.plannedAction || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{service.dueDate || item.dueDate || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{service.progress || "No progress captured"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{service.status}</td><td className="border-b border-[#edf0f4] px-3 py-3"><button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => updateServiceProgress(index)}>Update Progress</button></td></tr>
                  }) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={5}>Intervention tasks will appear automatically from care plan items.</td></tr>}</tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        )}

        {activeTab === "notes" && (
          <div className="space-y-5">
            <SectionCard title="Case Notes">
              <div className="mb-3 flex justify-end">
                <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={addCaseNote}><Plus className="h-4 w-4" /> Add Case Note</button>
              </div>
              <div className="w-full max-w-full overflow-x-auto rounded-md border border-[#d8dee8]">
                <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                  <thead className="bg-[#f8fafc] text-[#2e6fa3]">
                    <tr>{["Date", "Activity Type", "Person Contacted", "Summary / Action Taken", "Follow-up Date", "Next Step", "Action"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr>
                  </thead>
                  <tbody>{caseNotes.length ? caseNotes.map((note, index) => (
                    <tr key={`${note.date}-${note.activityType}-${index}`} className="bg-white">
                      <td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]">{note.date || "-"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{note.activityType || "-"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{note.person || "Not captured"}</td>
                      <td className="max-w-[260px] border-b border-[#edf0f4] px-3 py-3">{note.summary || "No summary captured"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{note.followUp || "-"}</td>
                      <td className="max-w-[220px] border-b border-[#edf0f4] px-3 py-3">{note.nextStep || "No next step captured"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">
                        <div className="flex items-center gap-2">
                          <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#2e6fa3] hover:border-[#008c7a] hover:text-[#008c7a]" title="Edit case note" onClick={() => editCaseNote(index)}>
                            <PencilLine className="h-4 w-4" />
                          </button>
                          <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#f4b4ac] bg-white text-[#b42318] hover:bg-[#fff7f5]" title="Delete case note" onClick={() => removeCaseNote(index)}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={7}>No case notes captured yet. Add a case note to build the activity log.</td></tr>}</tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        )}

        {activeTab === "attachments" && (
          <div className="space-y-5">
            <SectionCard title="Attachments">
              <div className="mb-3 flex justify-end">
                <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={addCaseDocument}><Plus className="h-4 w-4" /> Add Document</button>
              </div>
              <div className="w-full max-w-full overflow-x-auto rounded-md border border-[#d8dee8]">
                <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                  <thead className="bg-[#f8fafc] text-[#2e6fa3]">
                    <tr>{["Document Type", "File", "Notes", "Preview", "Action"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr>
                  </thead>
                  <tbody>{caseDocuments.length ? caseDocuments.map((document, index) => (
                    <tr key={`${document.documentType}-${document.fileName}-${index}`} className="bg-white">
                      <td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]">{document.documentType || "-"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">
                        {document.fileName ? <button type="button" className="font-semibold text-[#30528c] underline-offset-2 hover:text-[#008c7a] hover:underline" onClick={() => openAttachmentPreview(document)}>{document.fileName}</button> : "No file selected"}
                      </td>
                      <td className="max-w-[320px] border-b border-[#edf0f4] px-3 py-3">{document.notes || "No notes captured"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">
                        <button type="button" className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747] disabled:cursor-not-allowed disabled:opacity-50" disabled={!document.fileName} onClick={() => openAttachmentPreview(document)}>Open</button>
                      </td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">
                        <div className="flex items-center gap-2">
                          <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#2e6fa3] hover:border-[#008c7a] hover:text-[#008c7a]" title="Edit document" onClick={() => editCaseDocument(index)}>
                            <PencilLine className="h-4 w-4" />
                          </button>
                          <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#f4b4ac] bg-white text-[#b42318] hover:bg-[#fff7f5]" title="Delete document" onClick={() => removeCaseDocument(index)}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={5}>No attachments captured yet. Add a document to show it in this table.</td></tr>}</tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        )}

        {activeTab === "monitoring" && (
          <div className="space-y-5">
            <SectionCard title="Monitoring Visits">
              <FormGrid>
                <Field label="Visit Date"><input className={inputClass} type="date" value={monitoring.visitDate} onChange={(event) => setMonitoring({ ...monitoring, visitDate: event.target.value })} /></Field>
                <Field label="Visit Type"><input className={inputClass} value={monitoring.visitType} onChange={(event) => setMonitoring({ ...monitoring, visitType: event.target.value })} /></Field>
                <Field label="Child Safe?"><select className={inputClass} value={monitoring.currentSituation.toLowerCase().includes("unsafe") ? "No" : "Yes"} onChange={(event) => setMonitoring({ ...monitoring, currentSituation: event.target.value === "No" ? "Child unsafe. " : monitoring.currentSituation.replace("Child unsafe. ", "") })}><option>Yes</option><option>No</option></select></Field>
                <Field label="Progress Outcome"><select className={inputClass} value={monitoring.progressOutcome} onChange={(event) => setMonitoring({ ...monitoring, progressOutcome: event.target.value })}>{["Improving", "No Change", "Deteriorating", "Escalated", "Ready for Closure"].map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field label="Next Visit Date"><input className={inputClass} type="date" value={monitoring.nextVisitDate} onChange={(event) => setMonitoring({ ...monitoring, nextVisitDate: event.target.value })} /></Field>
                <div className="md:col-span-2"><Field label="Current Situation / Progress / Challenges / New Risks"><textarea className={`${inputClass} min-h-[130px] py-3`} value={[monitoring.currentSituation, monitoring.progress, monitoring.challenges, monitoring.newRisks].filter(Boolean).join("\n")} onChange={(event) => setMonitoring({ ...monitoring, currentSituation: event.target.value })} /></Field></div>
              </FormGrid>
              <div className="mt-4 flex justify-end">
                <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={saveMonitoringVisit}>Save Monitoring Visit</button>
              </div>
            </SectionCard>
          </div>
        )}

        {activeTab === "review" && (
          <div className="space-y-5">
            <SectionCard title="Case Review">
              <FormGrid>
                <Field label="Review Date"><input className={inputClass} type="date" value={monitoring.reviewDate} onChange={(event) => setMonitoring({ ...monitoring, reviewDate: event.target.value })} /></Field>
                <Field label="Review Decision"><select className={inputClass} value={supervisorReviewDecision} onChange={(event) => setSupervisorReviewDecision(event.target.value)}>{["Continue case", "Revise care plan", "Ready for closure"].map((item) => <option key={item}>{item}</option>)}</select></Field>
                <div className="md:col-span-2"><Field label="Progress Summary / What Changed? / Goals Achieved? / New Risks?"><textarea className={`${inputClass} min-h-[120px] py-3`} value={[monitoring.progressSummary, monitoring.servicesCompleted, monitoring.outstandingNeeds, monitoring.supervisorComments].filter(Boolean).join("\n")} onChange={(event) => setMonitoring({ ...monitoring, progressSummary: event.target.value })} /></Field></div>
                <div className="md:col-span-2"><Field label="Supervisor Review Notes"><textarea className={`${inputClass} min-h-[100px] py-3`} value={supervisorReviewNotes} onChange={(event) => setSupervisorReviewNotes(event.target.value)} /></Field></div>
              </FormGrid>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <StatusPill label={row.caseReviewStatus || "20-day review cycle"} tone={row.caseReviewStatus === "Review required" ? "warning" : "review"} />
                <button className="rounded-md bg-[#263747] px-5 py-2 font-semibold text-white" onClick={recordSupervisorReview}>Record Supervisor Review</button>
              </div>
            </SectionCard>
          </div>
        )}

        {activeTab === "closure" && (
          <div className="space-y-5">
            <SectionCard title="Closure">
              <div className="mb-3"><StatusPill label={closureStatus} tone="review" /></div>
              <div className="mb-4 grid gap-2 md:grid-cols-4">
                {[
                  ["Child safe", monitoring.currentSituation.toLowerCase().includes("unsafe") ? "No" : "Yes"],
                  ["Goals achieved", activeInterventions.length ? "No" : "Yes"],
                  ["Services completed", activeInterventions.length ? "No" : "Yes"],
                  ["Risks reduced", overdueReferrals.length ? "No" : "Review"],
                ].map(([label, value]) => <div key={label} className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-3 text-sm"><div className="font-bold text-[#263747]">{label}</div><div className={`mt-1 font-semibold ${value === "Yes" ? "text-[#007464]" : "text-[#b42318]"}`}>{value}</div></div>)}
              </div>
              <FormGrid>
                <Field label="Closure Reason"><select className={inputClass} value={monitoring.closureReason} onChange={(event) => setMonitoring({ ...monitoring, closureReason: event.target.value })}>{["Goals Achieved", "Moved Away", "Transferred", "No Longer Requires Support", "Case Invalid", "Client Deceased", "Court Process Completed", "Other"].map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field label="Final Risk Level"><select className={inputClass} value={monitoring.finalRiskLevel} onChange={(event) => setMonitoring({ ...monitoring, finalRiskLevel: event.target.value })}>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((item) => <option key={item}>{item}</option>)}</select></Field>
                <div className="md:col-span-2"><Field label="Closure Summary / Services Provided / Remaining Concerns / Family Feedback / Recommendation"><textarea className={`${inputClass} min-h-[140px] py-3`} value={[monitoring.closureSummary, monitoring.servicesProvided, monitoring.remainingConcerns, monitoring.familyFeedback, monitoring.recommendation].filter(Boolean).join("\n")} onChange={(event) => setMonitoring({ ...monitoring, closureSummary: event.target.value })} /></Field></div>
              </FormGrid>
              <div className="mt-4 flex justify-end gap-2"><button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={saveClosureDraft}>Save Draft</button><button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={submitClosure}>Submit Closure</button></div>
            </SectionCard>
          </div>
        )}
        </fieldset>
      </Panel>
      {careModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-md border border-[#d8dee8] bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#dfe4eb] bg-white px-5 py-4">
              <div>
                <h3 className="text-xl font-extrabold text-[#263747]">{careModalIndex === null ? "Add Intervention" : "Edit Intervention"}</h3>
                <div className="mt-1 text-sm font-semibold text-[#64748b]">{row.id} | Care plan intervention</div>
              </div>
              <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setCareModalOpen(false)}>Close</button>
            </div>
            <div className="space-y-4 p-5">
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">1. Type of Assistance</h4>
                <FormGrid>
                  <Field label="Type of Assistance">
                    <select className={inputClass} value={careDraft.assistanceType} onChange={(event) => setCareDraftValue("assistanceType", event.target.value)}>
                      <option value="">Select</option>
                      {careAssistanceTypes.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </Field>
                </FormGrid>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">2. Assistance To Be Provided</h4>
                <Field label="Assistance To Be Provided"><textarea className={`${inputClass} min-h-[110px] py-3`} value={careDraft.plannedAction} onChange={(event) => setCareDraftValue("plannedAction", event.target.value)} placeholder="Describe the intervention, service or support to be provided." /></Field>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">3. Responsibility & Timeline</h4>
                <FormGrid>
                  <Field label="Responsible Person"><select className={inputClass} value={careDraft.responsiblePerson || ""} onChange={(event) => setCareDraftValue("responsiblePerson", event.target.value)}><option value="">Select</option>{careResponsibleOptions.map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <Field label="Timeline"><select className={inputClass} value={careDraft.timeline} onChange={(event) => setCareDraftValue("timeline", event.target.value)}><option value="">Select</option>{careTimelineOptions.map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <Field label="Target Date"><input className={inputClass} type="date" value={careDraft.dueDate} onChange={(event) => setCareDraftValue("dueDate", event.target.value)} /></Field>
                  <Field label="Status"><select className={inputClass} value={careDraft.status} onChange={(event) => setCareDraftValue("status", event.target.value)}>{carePlanStatuses.map((item) => <option key={item}>{item}</option>)}</select></Field>
                </FormGrid>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">4. Expected Outcome</h4>
                <Field label="Expected Outcome"><textarea className={`${inputClass} min-h-[90px] py-3`} value={careDraft.expectedOutcome} onChange={(event) => setCareDraftValue("expectedOutcome", event.target.value)} placeholder="Expected result once this intervention is completed." /></Field>
              </section>
              {["Court Supervision", "Child Justice Assistance", "Pre-trial Diversion"].includes(careDraft.assistanceType) && (
                <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                  <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">5. Link to Court</h4>
                  <Field label="Recommendation to Children's Court"><textarea className={`${inputClass} min-h-[90px] py-3`} value={careDraft.courtRecommendation || ""} onChange={(event) => setCareDraftValue("courtRecommendation", event.target.value)} /></Field>
                </section>
              )}
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[#dfe4eb] bg-white px-5 py-4">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={() => setCareModalOpen(false)}>Cancel</button>
              <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={saveCareIntervention}>Save Intervention</button>
            </div>
          </div>
        </div>
      )}
      {referralModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-md border border-[#d8dee8] bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-[#dfe4eb] pb-3">
              <div>
                <h3 className="text-lg font-bold text-[#263747]">{referralModalIndex === null ? "Create Referral" : "Edit Referral"}</h3>
                <div className="text-sm font-semibold text-[#64748b]">{row.id}</div>
              </div>
              <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setReferralModalOpen(false)}>Close</button>
            </div>
            <FormGrid>
              <Field label="Linked Care Plan Item"><select className={inputClass} value={referralDraft.linkedCarePlanItem} onChange={(event) => setReferralDraftValue("linkedCarePlanItem", event.target.value)}><option value="">Not linked</option>{careRows.map((item, index) => <option key={`${item.assistanceType}-${index}`} value={item.assistanceType || item.plannedAction}>{item.assistanceType || item.plannedAction}</option>)}</select></Field>
              <Field label="Referral Type"><select className={inputClass} value={referralDraft.type} onChange={(event) => setReferralDraftValue("type", event.target.value)}>{referralTypes.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Referred To"><input className={inputClass} value={referralDraft.referredTo} onChange={(event) => setReferralDraftValue("referredTo", event.target.value)} /></Field>
              <Field label="Referral Date"><input className={inputClass} type="date" value={referralDraft.date} onChange={(event) => setReferralDraftValue("date", event.target.value)} /></Field>
              <Field label="Follow-up Date"><input className={inputClass} type="date" value={referralDraft.followUpDate} onChange={(event) => setReferralDraftValue("followUpDate", event.target.value)} /></Field>
              <Field label="Status"><select className={inputClass} value={referralDraft.status} onChange={(event) => setReferralDraftValue("status", event.target.value)}>{referralStatuses.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <div className="md:col-span-2"><Field label="Reason"><textarea className={`${inputClass} min-h-[90px] py-3`} value={referralDraft.reason} onChange={(event) => setReferralDraftValue("reason", event.target.value)} /></Field></div>
              <div className="md:col-span-2"><Field label="Outcome / Feedback"><textarea className={`${inputClass} min-h-[90px] py-3`} value={referralDraft.outcome} onChange={(event) => setReferralDraftValue("outcome", event.target.value)} /></Field></div>
            </FormGrid>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={() => setReferralModalOpen(false)}>Cancel</button>
              <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={saveReferral}>Save Referral</button>
            </div>
          </div>
        </div>
      )}
      {caseNoteModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-md border border-[#d8dee8] bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-[#dfe4eb] pb-3">
              <div>
                <h3 className="text-lg font-bold text-[#263747]">{caseNoteModalIndex === null ? "Add Case Note" : "Edit Case Note"}</h3>
                <div className="text-sm font-semibold text-[#64748b]">{row.id}</div>
              </div>
              <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setCaseNoteModalOpen(false)}>Close</button>
            </div>
            <FormGrid>
              <Field label="Date"><input className={inputClass} type="date" value={caseNoteDraft.date} onChange={(event) => setCaseNoteDraftValue("date", event.target.value)} /></Field>
              <Field label="Activity Type"><select className={inputClass} value={caseNoteDraft.activityType} onChange={(event) => setCaseNoteDraftValue("activityType", event.target.value)}>{caseNoteActivityTypes.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Person Contacted"><input className={inputClass} value={caseNoteDraft.person} onChange={(event) => setCaseNoteDraftValue("person", event.target.value)} /></Field>
              <Field label="Follow-up Date"><input className={inputClass} type="date" value={caseNoteDraft.followUp} onChange={(event) => setCaseNoteDraftValue("followUp", event.target.value)} /></Field>
              <div className="md:col-span-2"><Field label="Summary / Action Taken"><textarea className={`${inputClass} min-h-[100px] py-3`} value={caseNoteDraft.summary} onChange={(event) => setCaseNoteDraftValue("summary", event.target.value)} /></Field></div>
              <div className="md:col-span-2"><Field label="Next Step"><textarea className={`${inputClass} min-h-[90px] py-3`} value={caseNoteDraft.nextStep} onChange={(event) => setCaseNoteDraftValue("nextStep", event.target.value)} /></Field></div>
            </FormGrid>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={() => setCaseNoteModalOpen(false)}>Cancel</button>
              <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={saveCaseNote}>Save Case Note</button>
            </div>
          </div>
        </div>
      )}
      {documentModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-md border border-[#d8dee8] bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-[#dfe4eb] pb-3">
              <div>
                <h3 className="text-lg font-bold text-[#263747]">{documentModalIndex === null ? "Add Document" : "Edit Document"}</h3>
                <div className="text-sm font-semibold text-[#64748b]">{row.id}</div>
              </div>
              <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setDocumentModalOpen(false)}>Close</button>
            </div>
            <FormGrid>
              <Field label="Document Type"><select className={inputClass} value={documentDraft.documentType} onChange={(event) => setDocumentDraftValue("documentType", event.target.value)}>{documentTypes.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Upload File"><input className={inputClass} type="file" onChange={(event) => setDocumentDraftFile(event.target.files?.[0])} /></Field>
              <div className="md:col-span-2"><Field label="Notes"><textarea className={`${inputClass} min-h-[90px] py-3`} value={documentDraft.notes} onChange={(event) => setDocumentDraftValue("notes", event.target.value)} /></Field></div>
              {documentDraft.fileName && <div className="md:col-span-2 text-sm font-semibold text-[#007464]">Selected file: {documentDraft.fileName}</div>}
            </FormGrid>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={() => setDocumentModalOpen(false)}>Cancel</button>
              <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={saveCaseDocument}>Save Document</button>
            </div>
          </div>
        </div>
      )}
      {serviceModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="w-full max-w-2xl rounded-md border border-[#d8dee8] bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-[#dfe4eb] pb-3">
              <div>
                <h3 className="text-lg font-bold text-[#263747]">Update Progress</h3>
                <div className="text-sm font-semibold text-[#64748b]">{serviceDraft.plannedAction || row.id}</div>
              </div>
              <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setServiceModalOpen(false)}>Close</button>
            </div>
            <FormGrid>
              <div className="md:col-span-2"><Field label="Progress update"><textarea className={`${inputClass} min-h-[100px] py-3`} value={serviceDraft.progress} onChange={(event) => setServiceDraft((current) => ({ ...current, progress: event.target.value }))} /></Field></div>
              <Field label="Date"><input className={inputClass} type="date" value={serviceDraft.updateDate} onChange={(event) => setServiceDraft((current) => ({ ...current, updateDate: event.target.value }))} /></Field>
              <Field label="Due Date"><input className={inputClass} type="date" value={serviceDraft.dueDate} onChange={(event) => setServiceDraft((current) => ({ ...current, dueDate: event.target.value }))} /></Field>
              <Field label="Status"><select className={inputClass} value={serviceDraft.status} onChange={(event) => setServiceDraft((current) => ({ ...current, status: event.target.value }))}>{serviceStatuses.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <div className="md:col-span-2"><Field label="Outcome"><textarea className={`${inputClass} min-h-[90px] py-3`} value={serviceDraft.outcome} onChange={(event) => setServiceDraft((current) => ({ ...current, outcome: event.target.value }))} /></Field></div>
            </FormGrid>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={() => setServiceModalOpen(false)}>Cancel</button>
              <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={saveServiceProgress}>Save Progress</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="min-w-0 overflow-hidden rounded-md border border-[#d8dee8] bg-white p-4"><h3 className="mb-3 text-lg font-bold text-[#263747]">{title}</h3>{children}</section>
}

function AssessmentTextSection({ title, items, values, onChange }: { title: string; items: [string, string][]; values: Record<string, unknown>; onChange: (key: any, value: string) => void }) {
  return (
    <SectionCard title={title}>
      <FormGrid>
        {items.map(([label, key]) => (
          <div key={key} className="md:col-span-2">
            <Field label={label}><textarea className={`${inputClass} min-h-[95px] py-3`} value={`${values[key] || ""}`} onChange={(event) => onChange(key, event.target.value)} /></Field>
          </div>
        ))}
      </FormGrid>
    </SectionCard>
  )
}

function RequestUpdateModal({ row, intakeId, caseReference, tab, onClose }: { row?: DistrictHeadCaseRow; intakeId?: number; caseReference?: string; tab: IntakeUpdateTab; onClose: () => void }) {
  const [selected, setSelected] = useState<Record<string, IntakeUpdateField>>({})
  const [reason, setReason] = useState("")
  const [message, setMessage] = useState("")
  const targetIntakeId = intakeId || row?.backendIntakeId
  const targetCaseReference = caseReference || row?.id || "selected case"
  function toggle(field: IntakeUpdateField) {
    setSelected((current) => {
      const next = { ...current }
      if (next[field.path]) delete next[field.path]
      else next[field.path] = { ...field, proposed_value: "" }
      return next
    })
  }
  function setProposed(path: string, value: string) {
    setSelected((current) => ({ ...current, [path]: { ...current[path], proposed_value: value } }))
  }
  async function submit() {
    const fields = Object.values(selected)
    if (!targetIntakeId || !fields.length || !reason.trim()) {
      setMessage("Select at least one field and enter the reason for the update.")
      return
    }
    await apiPost("/update-requests/", { intake: targetIntakeId, tab: tab.label, requested_fields: fields, reason })
    setMessage("Update request submitted to the District Head.")
    setTimeout(onClose, 900)
  }
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[#102033]/60 p-4">
      <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-md bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-[#263747]">Request Update: {tab.label}</h3>
            <div className="text-sm font-semibold text-[#64748b]">{targetCaseReference}</div>
          </div>
          <button className="rounded-md border border-[#d8dee8] px-3 py-1 text-sm font-semibold" onClick={onClose}>Close</button>
        </div>
        <div className="space-y-3">
          {tab.fields.map((field) => (
            <div key={field.path} className="rounded-md border border-[#d8dee8] p-3">
              <label className="flex items-start gap-3 font-semibold text-[#263747]">
                <input type="checkbox" className="mt-1" checked={Boolean(selected[field.path])} onChange={() => toggle(field)} />
                <span className="flex-1"><span className="block">{field.label}</span><span className="mt-1 block text-xs text-[#64748b]">Current: {field.current_value}</span></span>
              </label>
              {selected[field.path] && <textarea className={`${inputClass} mt-3 min-h-[78px] py-2`} placeholder="Proposed new value" value={selected[field.path].proposed_value || ""} onChange={(event) => setProposed(field.path, event.target.value)} />}
            </div>
          ))}
        </div>
        <Field label="Reason for update"><textarea className={`${inputClass} min-h-[110px] py-3`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="New information, correction, merge duplicate, disclosure, or other reason." /></Field>
        {message && <div className="mt-3 rounded-md border border-[#b7e4d8] bg-[#f0fdf9] p-3 text-sm font-semibold text-[#007464]">{message}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="rounded-md border border-[#d8dee8] px-4 py-2 font-semibold" onClick={onClose}>Cancel</button>
          <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={submit}>Submit Request</button>
        </div>
      </div>
    </div>
  )
}

function AllocatedCaseDetails({ row }: { row: DistrictHeadCaseRow }) {
  const alert = row.sourceAlert
  const empty = "Not captured"
  const sections = [
    { title: "Child Details", fields: [["Full Name", row.childName], ["Sex", row.sex], ["DOB", empty], ["Age", row.age], ["ID Number", empty], ["Birth Registration Status", empty], ["Disability Status", empty], ["Language", empty], ["Religion", empty], ["Address", empty], ["Province", empty], ["District", row.district], ["Ward", row.ward], ["Village", empty], ["School", empty], ["Clinic", empty], ["Contact Details", empty]] },
    { title: "Family Details", fields: [["Parents/Guardians", empty], ["Relationship", empty], ["Phone numbers", empty], ["Addresses", empty], ["Siblings", empty], ["Significant Others", empty]] },
    { title: "Case Details", fields: [["Alert Source", row.sourceAlertId || "Manual intake"], ["Informant Details", alert?.reporter || empty], ["Case Category", row.concern], ["Protection Type", row.concern], ["Welfare Type", empty], ["Court Orders", row.concern.toLowerCase().includes("court") ? row.concern : empty], ["Prosecution Information", alert?.danger?.includes("Police already involved") ? "Police already involved" : empty], ["Concern Description", row.description || empty]] },
    { title: "Background Information", fields: [["Background", row.description || empty], ["Previous contact", empty], ["Services known", empty], ["Environmental notes", empty]] },
    { title: "Timeline", fields: [["Alert Raised", alert?.submittedAt || empty], ["Intake Started", row.createdAt], ["Intake Submitted", row.createdAt], ["Screening Completed", row.createdAt], ["Case Allocated", allocatedDate(row)], ["Responsible Officer", row.allocatedOfficer || empty]] },
  ]
  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <SectionCard key={section.title} title={section.title}>
          {section.title === "Family Details" && <button className="mb-3 rounded-md border border-[#d8dee8] bg-white px-4 py-2 text-sm font-semibold text-[#263747]">Update Family Details</button>}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{section.fields.map(([label, value]) => <Info key={`${section.title}-${label}`} label={label} value={value || empty} />)}</div>
        </SectionCard>
      ))}
    </div>
  )
}

function UpdateRequestQueue({ user }: { user: ApiUser }) {
  const [requests, setRequests] = useState<IntakeUpdateRequest[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [notes, setNotes] = useState("")
  const [message, setMessage] = useState("")
  const selected = requests.find((item) => item.id === selectedId) || requests[0]

  async function loadRequests() {
    const data = await apiGet<IntakeUpdateRequest[]>("/update-requests/")
    setRequests(data)
    if (!selectedId && data[0]) setSelectedId(data[0].id)
  }

  useEffect(() => {
    void loadRequests()
  }, [])

  async function review(decision: "approve" | "reject") {
    if (!selected) return
    const updated = await apiPost<IntakeUpdateRequest>(`/update-requests/${selected.id}/review/`, { decision, review_notes: notes })
    setRequests((items) => items.map((item) => item.id === updated.id ? updated : item))
    setMessage(decision === "approve" ? `Update request for ${updated.caseReference} approved and applied.` : `Update request for ${updated.caseReference} rejected.`)
    setNotes("")
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Panel title="Intake Update Requests" icon={History} action={`${requests.filter((item) => item.status === "Pending").length} pending`}>
        <div className="overflow-x-auto rounded-md border border-[#d8dee8] bg-white">
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Case", "Tab", "Fields", "Requested By", "Requested At", "Status"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
            <tbody>
              {requests.length ? requests.map((request) => (
                <tr key={request.id} className={selected?.id === request.id ? "bg-[#e7f6f3]" : "bg-white hover:bg-[#f8fafc]"} onClick={() => setSelectedId(request.id)}>
                  <td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#30528c]">{request.caseReference}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{request.tab}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{request.requested_fields.length}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{request.requestedByName}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3">{formatWorkflowDateTime(request.requested_at)}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-3"><StatusBadge status={request.status} /></td>
                </tr>
              )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={6}>No intake update requests found.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      <aside className="h-fit rounded-md border border-[#d8dee8] bg-white p-5 shadow-sm">
        <div className="text-xs font-bold uppercase text-[#64748b]">{user.profile.roleLabel}</div>
        <h3 className="mt-1 text-lg font-bold text-[#263747]">Review Request</h3>
        {selected ? (
          <div className="mt-4 space-y-4">
            <Info label="Case" value={selected.caseReference} />
            <Info label="Tab" value={selected.tab} />
            <Info label="Reason" value={selected.reason} />
            <div className="space-y-3">
              {selected.requested_fields.map((field) => (
                <div key={field.path} className="rounded-md border border-[#edf0f4] bg-[#f8fafc] p-3">
                  <div className="text-xs font-bold uppercase text-[#64748b]">{field.label}</div>
                  <div className="mt-2 text-sm"><span className="font-bold text-[#263747]">Current:</span> {field.current_value || "Not captured"}</div>
                  <div className="mt-1 text-sm"><span className="font-bold text-[#263747]">Proposed:</span> {field.proposed_value || "No value supplied"}</div>
                </div>
              ))}
            </div>
            <Field label="Review notes"><textarea className={`${inputClass} min-h-[110px] py-3`} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
            {message && <div className="rounded-md border border-[#b7e4d8] bg-[#f0fdf9] p-3 text-sm font-semibold text-[#007464]">{message}</div>}
            <div className="grid gap-2">
              <button className="rounded-md bg-[#008c7a] px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={selected.status !== "Pending"} onClick={() => review("approve")}>Approve and Apply</button>
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747] disabled:opacity-50" disabled={selected.status !== "Pending"} onClick={() => review("reject")}>Reject Request</button>
            </div>
          </div>
        ) : <div className="mt-4 text-sm text-[#64748b]">Select a request to review.</div>}
      </aside>
    </div>
  )
}

function DistrictHeadDashboard({ user, users, alerts, cases, calendarTasks, setSelectedAlertId, setSelectedCaseId, setView }: { user: ApiUser; users: ApiUser[]; alerts: AlertRecord[]; cases: CaseRecord[]; calendarTasks: CalendarTask[]; setSelectedAlertId: (id: string) => void; setSelectedCaseId: (id: string) => void; setView: (view: string) => void }) {
  const [updateRequests, setUpdateRequests] = useState<IntakeUpdateRequest[]>([])
  const districtName = user.profile.districtName || "District"
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const next7End = todayStart + 7 * 24 * 60 * 60 * 1000
  const districtAlerts = alerts.filter((alert) => !user.profile.districtName || alert.district === user.profile.districtName)
  const districtCases = cases.filter((caseRecord) => !isEmptyManualPlaceholder(caseRecord) && (!user.profile.districtName || caseRecord.district === user.profile.districtName))
  const submittedReview = districtCases.filter((caseRecord) => caseRecord.status === "Pending Supervisor Review")
  const allocationReady = districtCases.filter((caseRecord) => caseRecord.status === "Approved for Allocation")
  const closureRequests = districtCases.filter((caseRecord) => ["Submitted", "Pending Supervisor Review"].includes(caseRecord.closureStatus || ""))
  const pendingUpdateRequests = updateRequests.filter((request) => request.status === "Pending")
  const highRiskCases = districtCases.filter((caseRecord) => ["HIGH", "CRITICAL"].includes(caseRecord.riskLevel.toUpperCase()))
  const activeEmergencyAlerts = districtAlerts.filter((alert) => alert.emergency && !["Converted to Case", "Closed - No Further Action", "Closed - Invalid", "Rejected"].includes(alert.internalStatus))
  const overdueAssessments = districtCases.filter((caseRecord) => caseRecord.assessmentSlaStatus === "Overdue" || (caseRecord.assessmentDueAt && new Date(caseRecord.assessmentDueAt).getTime() < Date.now() && !caseRecord.assessmentCompletedAt))
  const nearingAssessmentBreach = districtCases.filter((caseRecord) => caseRecord.assessmentRemainingSeconds != null && caseRecord.assessmentRemainingSeconds > 0 && caseRecord.assessmentRemainingSeconds <= 48 * 60 * 60)
  const emergencyHandled = activeEmergencyAlerts.length ? Math.max(0, activeEmergencyAlerts.length - districtCases.filter((caseRecord) => caseRecord.riskLevel.toUpperCase() === "CRITICAL" && ["Allocated", "Pending Supervisor Review"].includes(caseRecord.status)).length) : 0
  const districtOfficers = users.filter((item) => item.profile.role === "DSDO" && (!user.profile.districtName || item.profile.districtName === user.profile.districtName))
  const officerNames = districtOfficers.map((officer) => {
    const name = [officer.first_name, officer.last_name].filter(Boolean).join(" ") || officer.username
    return { key: officer.username, name }
  })
  const allocationLoad = officerNames.map((officer) => {
    const allocated = districtCases.filter((caseRecord) => caseRecord.status === "Allocated" && (caseRecord.allocatedOfficer === officer.name || caseRecord.allocatedOfficer === officer.key || caseRecord.allocatedOfficer?.includes(officer.name)))
    return {
      ...officer,
      count: allocated.length,
      critical: allocated.filter((caseRecord) => caseRecord.riskLevel.toUpperCase() === "CRITICAL").length,
      tone: allocated.length >= 8 ? "Heavy" : allocated.length >= 4 ? "Balanced" : "Available",
    }
  }).sort((a, b) => b.count - a.count)
  const bottlenecks = [
    { label: "Draft too long", value: districtCases.filter((caseRecord) => caseRecord.status === "Draft" && daysSince(caseRecord.createdAt).replace(/\D/g, "") && Number(daysSince(caseRecord.createdAt).replace(/\D/g, "")) >= 2).length, detail: "Draft intake older than 2 days" },
    { label: "Supervisor review waiting", value: submittedReview.filter((caseRecord) => caseRecord.submittedForReviewAt && Date.now() - new Date(caseRecord.submittedForReviewAt).getTime() > 24 * 60 * 60 * 1000).length, detail: "Submitted over 24 hours ago" },
    { label: "Unallocated too long", value: allocationReady.filter((caseRecord) => caseRecord.submittedForReviewAt && Date.now() - new Date(caseRecord.submittedForReviewAt).getTime() > 24 * 60 * 60 * 1000).length, detail: "Ready but not assigned" },
    { label: "Assessment overdue", value: overdueAssessments.length, detail: "Allocated cases past assessment due date" },
    { label: "Care plan not moving", value: districtCases.filter((caseRecord) => caseRecord.assessmentCarePlanStatus && !["Submitted", "Approved", "Approved with Comments"].includes(caseRecord.assessmentCarePlanStatus)).length, detail: "Care plan still in draft/review" },
  ]
  const upcomingCaseDates = districtCases.flatMap((caseRecord) => [
    caseRecord.assessmentDueAt ? { date: caseRecord.assessmentDueAt, title: "Assessment due", detail: `${caseRecord.id} | ${caseRecord.childName}`, urgent: ["HIGH", "CRITICAL"].includes(caseRecord.riskLevel.toUpperCase()) } : null,
    caseRecord.caseReviewDueAt ? { date: caseRecord.caseReviewDueAt, title: "Supervisor review due", detail: `${caseRecord.id} | ${caseRecord.allocatedOfficer || "Unassigned"}`, urgent: false } : null,
  ]).filter(Boolean) as Array<{ date: string; title: string; detail: string; urgent: boolean }>
  const upcomingCalendar = calendarTasks.filter((task) => {
    const time = new Date(`${task.date}T00:00:00`).getTime()
    return time >= todayStart && time <= next7End
  }).map((task) => ({ date: task.date, title: task.title, detail: task.detail, urgent: task.urgent }))
  const upcoming = [...upcomingCaseDates, ...upcomingCalendar]
    .filter((item) => {
      const time = new Date(item.date).getTime()
      return Number.isFinite(time) && time >= todayStart && time <= next7End
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 6)
  const recentActivity = [
    ...districtAlerts.map((alert) => ({ date: alert.submittedAt, title: "New alert", detail: `${alert.id} | ${alert.childName}`, tone: alert.emergency ? "danger" : "review" })),
    ...districtCases.map((caseRecord) => ({ date: caseRecord.allocatedAt || caseRecord.submittedForReviewAt || caseRecord.createdAt, title: caseRecord.status, detail: `${caseRecord.id} | ${caseRecord.childName}`, tone: ["HIGH", "CRITICAL"].includes(caseRecord.riskLevel.toUpperCase()) ? "danger" : "review" })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 6)

  useEffect(() => {
    let mounted = true
    apiGet<IntakeUpdateRequest[]>("/update-requests/")
      .then((data) => { if (mounted) setUpdateRequests(data) })
      .catch(() => { if (mounted) setUpdateRequests([]) })
    return () => { mounted = false }
  }, [])

  function openQueue(viewName: string) {
    setView(viewName)
  }

  function openCase(caseRecord: CaseRecord) {
    if (caseRecord.sourceAlertId) setSelectedAlertId(caseRecord.sourceAlertId)
    setSelectedCaseId(caseRecord.id)
    setView(caseRecord.status === "Pending Supervisor Review" ? "review" : caseRecord.status === "Approved for Allocation" ? "allocation" : "allocated-cases")
  }

  return (
    <div className="space-y-5 text-[#263747]">
      <section className="rounded-md border border-[#d8dee8] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#263747]">{districtName} Supervision Dashboard</h1>
            <p className="mt-1 text-sm font-semibold text-[#64748b]">Approvals, risk, workload and deadlines across the district.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-md bg-[#008c7a] px-4 py-2 text-sm font-bold text-white" onClick={() => openQueue("review")}>Review submitted cases</button>
            <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 text-sm font-bold text-[#263747]" onClick={() => openQueue("allocation")}>Allocate cases</button>
            <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 text-sm font-bold text-[#263747]" onClick={() => openQueue("update-requests")}>Update requests</button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DecisionCard icon={ClipboardCheck} label="Submitted intakes awaiting review" value={submittedReview.length} action="Open review queue" onClick={() => openQueue("review")} tone="bg-[#7c4d9e]" />
        <DecisionCard icon={History} label="Update requests awaiting approval" value={pendingUpdateRequests.length} action="Review updates" onClick={() => openQueue("update-requests")} tone="bg-[#2e6fa3]" />
        <DecisionCard icon={Lock} label="Allocation-ready cases" value={allocationReady.length} action="Allocate now" onClick={() => openQueue("allocation")} tone="bg-[#a05b16]" />
        <DecisionCard icon={FolderCheck} label="Closure requests" value={closureRequests.length} action="Review closures" onClick={() => openQueue("allocated-cases")} tone="bg-[#008c7a]" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid gap-4 lg:grid-cols-2">
          <DashboardSection title="District Risk Snapshot" icon={ShieldAlert}>
            <div className="grid gap-3 sm:grid-cols-2">
              <RiskTile label="Critical / high cases" value={highRiskCases.length} tone="danger" />
              <RiskTile label="Emergency alerts still active" value={activeEmergencyAlerts.length} tone="danger" />
              <RiskTile label="Overdue assessments" value={overdueAssessments.length} tone="warning" />
              <RiskTile label="Nearing SLA breach" value={nearingAssessmentBreach.length} tone="warning" />
            </div>
            <div className="mt-3 rounded-md border border-[#d8dee8] bg-[#f8fafc] p-3 text-sm font-semibold text-[#64748b]">
              Emergency handling check: {emergencyHandled ? `${emergencyHandled} emergency alert(s) still need visible action.` : "No active emergency alert is waiting without visible case action."}
            </div>
          </DashboardSection>

          <DashboardSection title="Workflow Bottlenecks" icon={Clock3}>
            <div className="space-y-2">
              {bottlenecks.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 rounded-md border border-[#edf0f4] bg-[#f8fafc] p-3">
                  <div>
                    <div className="font-bold text-[#263747]">{item.label}</div>
                    <div className="text-xs font-semibold text-[#64748b]">{item.detail}</div>
                  </div>
                  <span className={`grid h-9 min-w-9 place-items-center rounded-md px-2 text-sm font-bold ${item.value ? "bg-[#fff4d6] text-[#a05b16]" : "bg-[#e7f6f3] text-[#007464]"}`}>{item.value}</span>
                </div>
              ))}
            </div>
          </DashboardSection>

          <DashboardSection title="Allocation Load" icon={Users}>
            <div className="space-y-2">
              {allocationLoad.length ? allocationLoad.map((officer) => (
                <div key={officer.key} className="rounded-md border border-[#edf0f4] bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-bold text-[#263747]">{officer.name}</div>
                      <div className="text-xs font-semibold text-[#64748b]">{officer.critical} critical case(s)</div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${officer.tone === "Heavy" ? "bg-[#fee4e2] text-[#b42318]" : officer.tone === "Balanced" ? "bg-[#fff4d6] text-[#a05b16]" : "bg-[#e7f6f3] text-[#007464]"}`}>{officer.tone}</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e2e8f0]">
                    <div className="h-full bg-[#008c7a]" style={{ width: `${Math.min(100, officer.count * 12)}%` }} />
                  </div>
                  <div className="mt-2 text-sm font-bold text-[#30528c]">{officer.count} allocated case(s)</div>
                </div>
              )) : <EmptyState text="No DSDO officers are registered for this district yet." />}
            </div>
          </DashboardSection>

          <DashboardSection title="Today / Next 7 Days" icon={CalendarDays}>
            <div className="space-y-2">
              {upcoming.length ? upcoming.map((item) => (
                <div key={`${item.title}-${item.detail}-${item.date}`} className="flex gap-3 rounded-md border border-[#edf0f4] bg-[#f8fafc] p-3">
                  <span className={`mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-white ${item.urgent ? "bg-[#ff5058]" : "bg-[#008c7a]"}`}>
                    {item.urgent ? <AlertTriangle className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0">
                    <div className="font-bold text-[#263747]">{item.title}</div>
                    <div className="text-xs font-semibold text-[#64748b]">{formatWorkflowDateTime(item.date)}</div>
                    <div className="mt-1 text-sm text-[#50617a]">{item.detail}</div>
                  </div>
                </div>
              )) : <EmptyState text="No district deadlines in the next 7 days." />}
            </div>
          </DashboardSection>
        </div>

        <aside className="space-y-4">
          <DashboardSection title="High Risk / Overdue Cases" icon={AlertTriangle}>
            <div className="space-y-2">
              {[...highRiskCases, ...overdueAssessments].filter((item, index, list) => list.findIndex((row) => row.id === item.id) === index).slice(0, 6).map((caseRecord) => (
                <button key={caseRecord.id} className="block w-full rounded-md border border-[#edf0f4] bg-white p-3 text-left hover:border-[#008c7a] hover:bg-[#e7f6f3]" onClick={() => openCase(caseRecord)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-[#263747]">{caseRecord.id}</span>
                    <span className="rounded-full bg-[#fee4e2] px-2 py-1 text-[11px] font-bold text-[#b42318]">{caseRecord.riskLevel}</span>
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[#64748b]">{caseRecord.childName} | {caseRecord.allocatedOfficer || "Unassigned"}</div>
                </button>
              ))}
              {!highRiskCases.length && !overdueAssessments.length && <EmptyState text="No high-risk or overdue district cases." />}
            </div>
          </DashboardSection>

          <DashboardSection title="Recent District Activity" icon={History}>
            <div className="space-y-2">
              {recentActivity.map((item) => (
                <div key={`${item.title}-${item.detail}-${item.date}`} className="rounded-md border border-[#edf0f4] bg-[#f8fafc] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-[#263747]">{item.title}</div>
                    <span className={`h-2 w-2 rounded-full ${item.tone === "danger" ? "bg-[#b42318]" : "bg-[#008c7a]"}`} />
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[#64748b]">{item.detail}</div>
                  <div className="mt-1 text-xs text-[#64748b]">{formatWorkflowDateTime(item.date)}</div>
                </div>
              ))}
              {!recentActivity.length && <EmptyState text="No recent district activity yet." />}
            </div>
          </DashboardSection>
        </aside>
      </section>
    </div>
  )
}

function DecisionCard({ icon: Icon, label, value, action, tone, onClick }: { icon: ElementType; label: string; value: number; action: string; tone: string; onClick: () => void }) {
  return (
    <article className="rounded-md border border-[#d8dee8] bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-md text-white ${tone}`}><Icon className="h-5 w-5" /></div>
        <div className="min-w-0">
          <div className="text-3xl font-bold leading-none text-[#263747]">{value}</div>
          <div className="mt-2 text-sm font-bold leading-tight text-[#30528c]">{label}</div>
        </div>
      </div>
      <button className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[#008c7a] hover:underline" onClick={onClick}>{action}<ArrowRight className="h-4 w-4" /></button>
    </article>
  )
}

function DashboardSection({ title, icon: Icon, children }: { title: string; icon: ElementType; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-md border border-[#d8dee8] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 border-b border-[#edf0f4] pb-3">
        <Icon className="h-5 w-5 text-[#008c7a]" />
        <h2 className="text-lg font-bold text-[#263747]">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function RiskTile({ label, value, tone }: { label: string; value: number; tone: "danger" | "warning" }) {
  return (
    <div className={`rounded-md border p-3 ${tone === "danger" ? "border-[#f4b4ac] bg-[#fff7f5]" : "border-[#f3d38b] bg-[#fffaf0]"}`}>
      <div className={`text-2xl font-bold ${tone === "danger" ? "text-[#b42318]" : "text-[#a05b16]"}`}>{value}</div>
      <div className="mt-1 text-sm font-bold text-[#50617a]">{label}</div>
    </div>
  )
}

function InternalDashboard({ user, users, alerts, cases, calendarTasks, setSelectedAlertId, setSelectedCaseId, setView }: { user: ApiUser; users: ApiUser[]; alerts: AlertRecord[]; cases: CaseRecord[]; calendarTasks: CalendarTask[]; setSelectedAlertId: (id: string) => void; setSelectedCaseId: (id: string) => void; setView: (view: string) => void }) {
  if (user.profile.role === "DISTRICT_HEAD") {
    return <DistrictHeadDashboard user={user} users={users} alerts={alerts} cases={cases} calendarTasks={calendarTasks} setSelectedAlertId={setSelectedAlertId} setSelectedCaseId={setSelectedCaseId} setView={setView} />
  }

  const [selectedRegion, setSelectedRegion] = useState("Zimbabwe")
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<number | null>(null)
  const currentDate = new Date()
  const today = currentDate.getDate()
  const currentYear = currentDate.getFullYear()
  const currentMonth = currentDate.getMonth()
  const monthName = currentDate.toLocaleString("default", { month: "long", year: "numeric" })
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
  const firstDayOffset = (new Date(currentYear, currentMonth, 1).getDay() + 6) % 7
  const calendarDays: (number | null)[] = [...Array(firstDayOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)]
  const visibleCases = cases.filter((caseRecord) => !isEmptyManualPlaceholder(caseRecord))
  const operationalCases = visibleCases.filter((caseRecord) => ["Pending Supervisor Review", "Approved for Allocation", "Allocated"].includes(caseRecord.status))
  const casePoints = operationalCases.map((caseRecord, index) => ({
    ...caseRecord,
    lat: caseRecord.district === "Harare" ? -17.8292 : caseRecord.district === "Masvingo" ? -20.0744 : -21.05,
    lng: caseRecord.district === "Harare" ? 31.0522 : caseRecord.district === "Masvingo" ? 30.8328 : 31.67,
    priority: ["HIGH", "CRITICAL"].includes(caseRecord.riskLevel.toUpperCase()) ? "High" : caseRecord.riskLevel.toUpperCase() === "MEDIUM" ? "Medium" : "Low",
    offset: index * 0.08,
  }))
  const selectedDistricts = zimbabweRegions.find((region) => region.name === selectedRegion)?.districts ?? []
  const immediateActionAlerts = alerts.filter((alert) => [alert.internalStatus, alert.status].includes("Immediate Action Required"))
  const highPriority = alerts.filter((alert) => alert.emergency).length
  const selectedCases = visibleCases.filter((caseRecord) => selectedRegion === "Zimbabwe" || caseRecord.district === selectedRegion || selectedDistricts.includes(caseRecord.district))
  const selectedOperationalCases = operationalCases.filter((caseRecord) => selectedRegion === "Zimbabwe" || caseRecord.district === selectedRegion || selectedDistricts.includes(caseRecord.district))
  const monthTasks = calendarTasks.filter((task) => {
    const date = new Date(`${task.date}T00:00:00`)
    return date.getFullYear() === currentYear && date.getMonth() === currentMonth
  })
  const calendarMarkers = new Set(monthTasks.map((task) => Number(task.date.slice(8, 10))).filter(Boolean))
  const todoItems = monthTasks.map((task) => ({
    day: Number(task.date.slice(8, 10)),
    date: task.date,
    title: task.title,
    detail: task.detail,
    meta: task.source,
    urgent: task.urgent,
  }))
  const visibleTodos = selectedCalendarDay ? todoItems.filter((item) => item.day === selectedCalendarDay) : todoItems.slice(0, 4)

  function openCase(caseRecord: DashboardCasePoint) {
    if (caseRecord.sourceAlertId) setSelectedAlertId(caseRecord.sourceAlertId)
    setSelectedCaseId(caseRecord.id)
    setView("case-intake")
  }

  return (
    <div className="space-y-5 text-[#263747]">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MonitorStat icon={Inbox} label="Open Alerts" value={immediateActionAlerts.length} iconTone="bg-[#ff5058]" />
        <MonitorStat icon={ShieldAlert} label="High Priority" value={highPriority} iconTone="bg-[#b42318]" />
        <MonitorStat icon={ClipboardCheck} label="Draft Cases" value={visibleCases.filter((caseRecord) => caseRecord.status === "Draft").length} iconTone="bg-[#7460bd]" />
        <MonitorStat icon={UserCheck} label="Allocated" value={visibleCases.filter((caseRecord) => caseRecord.status === "Allocated").length} iconTone="bg-[#20c455]" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-md border border-[#d8dee8] bg-gradient-to-br from-white via-white to-[#eef8ff] p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[18px] font-bold text-[#263747]"><CalendarDays className="h-5 w-5 text-[#008c7a]" /> {monthName}</div>
              <div className="text-[13px] text-[#64748b]">{selectedCalendarDay ? `Actions scheduled for ${monthName} ${selectedCalendarDay}` : "Scheduled case actions"}</div>
            </div>
            <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-[13px] font-semibold text-[#263747]" onClick={() => setSelectedCalendarDay(null)}>Month</button>
          </div>
          <div className="grid grid-cols-7 gap-2 text-center text-[12px] font-semibold text-[#64748b]">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day}>{day}</div>)}
            {calendarDays.map((day, index) => (
              day ? (
                <button
                  key={day}
                  className={`relative min-h-[58px] rounded-md border text-[14px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition ${selectedCalendarDay === day && day === today ? "border-[#008c7a] bg-[#d9f1ed] text-[#007464] ring-2 ring-[#008c7a]/15" : selectedCalendarDay === day ? "border-[#2e6fa3] bg-[#eef8ff] text-[#1f4f7a] ring-2 ring-[#2e6fa3]/10" : day === today ? "border-[#008c7a] bg-[#e7f6f3] text-[#007464]" : "border-[#edf0f4] bg-white/80 text-[#263747] hover:border-[#008c7a] hover:bg-white"}`}
                  onClick={() => setSelectedCalendarDay(day)}
                >
                  {day}
                  {calendarMarkers.has(day) && <span className="absolute bottom-2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[#ff5058]" />}
                </button>
              ) : <div key={`blank-${index}`} />
            ))}
          </div>
        </div>

        <aside className="rounded-md border border-[#d8dee8] bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[18px] font-bold text-[#263747]"><CheckSquare className="h-5 w-5 text-[#008c7a]" /> To Do</div>
              <div className="text-[13px] text-[#64748b]">Priority actions for the current desk</div>
            </div>
            <span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-bold text-[#263747]">{visibleTodos.length}</span>
          </div>
          <div className="space-y-3">
            {visibleTodos.length ? visibleTodos.map((item) => (
              <button key={`${item.meta}-${item.date}-${item.title}`} className="flex w-full gap-3 rounded-md border border-[#edf0f4] bg-[#f8fafc] p-3 text-left hover:border-[#008c7a] hover:bg-[#e7f6f3]">
                <span className={`mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-white ${item.urgent ? "bg-[#ff5058]" : "bg-[#008c7a]"}`}>
                  {item.urgent ? <AlertTriangle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                </span>
                <span className="min-w-0">
                  <span className="block font-bold text-[#263747]">{item.title}</span>
                  <span className="mt-1 block text-[13px] leading-tight text-[#64748b]">{item.detail}</span>
                  <span className="mt-2 flex flex-wrap gap-2">
                    <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${isPastLocalDate(item.date) ? "bg-[#fff1f0] text-[#b42318]" : "bg-[#ecfdf5] text-[#007464]"}`}>{relativeDueDateLabel(item.date)}</span>
                    <span className="inline-flex rounded-full bg-white px-2 py-1 text-[11px] font-bold text-[#30528c]">{item.meta}</span>
                  </span>
                </span>
              </button>
            )) : <div className="rounded-md border border-dashed border-[#d8dee8] bg-[#f8fafc] p-5 text-sm text-[#64748b]">No priority tasks scheduled for this date.</div>}
          </div>
        </aside>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="overflow-hidden rounded-md border border-[#d8dee8] bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8dee8] px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-[18px] font-bold text-[#263747]"><MapPin className="h-5 w-5 text-[#008c7a]" /> Geographic Coverage</div>
              <div className="text-[13px] text-[#64748b]">Click a region or marker to focus the operational summary.</div>
            </div>
            <button className="inline-flex items-center gap-2 rounded-md border border-[#d8dee8] px-3 py-2 text-[13px] font-semibold text-[#263747]" onClick={() => setSelectedRegion("Zimbabwe")}><Maximize2 className="h-4 w-4" /> Reset</button>
          </div>
          <ZimbabweLeafletMap casePoints={casePoints} selectedRegion={selectedRegion} openCase={openCase} />
        </div>

        <aside className="space-y-4">
          <div className="rounded-md border border-[#d8dee8] bg-white p-4 shadow-sm">
            <h2 className="text-[18px] font-bold text-[#263747]">{selectedRegion === "Zimbabwe" ? "Operational Overview" : selectedRegion}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <RegionStat label="Operational Cases" value={selectedRegion === "Zimbabwe" ? operationalCases.length : selectedOperationalCases.length} />
              <RegionStat label="High Priority" value={selectedRegion === "Zimbabwe" ? operationalCases.filter((row) => ["HIGH", "CRITICAL"].includes(row.riskLevel.toUpperCase())).length : selectedOperationalCases.filter((row) => ["HIGH", "CRITICAL"].includes(row.riskLevel.toUpperCase())).length} />
              <RegionStat label="All Drafts" value={selectedCases.filter((row) => row.status === "Draft").length} />
              <RegionStat label="Priority" value={selectedOperationalCases.some((row) => ["HIGH", "CRITICAL"].includes(row.riskLevel.toUpperCase())) ? "High" : "Normal"} />
            </div>
          </div>
          <div className="rounded-md border border-[#d8dee8] bg-white shadow-sm">
            <div className="border-b border-[#d8dee8] px-4 py-3 text-[18px] font-bold text-[#263747]">Active Work</div>
            <div className="max-h-[390px] overflow-auto">
              {casePoints.length ? casePoints.map((caseRecord) => (
                <button key={caseRecord.id} className="block w-full border-b border-[#edf0f4] px-4 py-3 text-left hover:bg-[#f8fafc]" onClick={() => openCase(caseRecord)}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-[#263747]">{caseRecord.concern}</span>
                    <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${caseRecord.priority === "High" ? "bg-[#fee4e2] text-[#b42318]" : caseRecord.priority === "Medium" ? "bg-[#fff4d6] text-[#a05b16]" : "bg-[#e7f6f3] text-[#007464]"}`}>{caseRecord.priority}</span>
                  </div>
                  <div className="mt-1 text-[13px] text-[#64748b]">{caseRecord.id} | {caseRecord.district} | {caseRecord.status}</div>
                </button>
              )) : <div className="p-5 text-sm text-[#64748b]">No submitted, approved, or allocated cases to map yet.</div>}
            </div>
          </div>
        </aside>
      </section>
    </div>
  )
}

function MonitorStat({ icon: Icon, label, value, iconTone }: { icon: ElementType; label: string; value: string | number; iconTone: string }) {
  return (
    <article className="flex min-h-[110px] items-center gap-5 rounded-md border border-[#d8dee8] bg-white px-5 py-4 shadow-sm">
      <div className={`grid h-[70px] w-[70px] shrink-0 place-items-center rounded-md text-white ${iconTone}`}>
        <Icon className="h-8 w-8" />
      </div>
      <div className="min-w-0">
        <div className="text-[30px] font-bold leading-none text-[#7789a6]">{value}</div>
        <div className="mt-2 text-[14px] leading-tight text-[#30528c]">{label}</div>
      </div>
    </article>
  )
}

function RegionStat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-md bg-[#f8fafc] p-3 ring-1 ring-[#edf0f4]"><div className="text-[12px] text-[#64748b]">{label}</div><div className="mt-1 text-[22px] font-bold text-[#263747]">{value}</div></div>
}

type DashboardCasePoint = CaseRecord & {
  lat: number
  lng: number
  priority: string
  offset: number
}

function ZimbabweLeafletMap({
  casePoints,
  selectedRegion,
  openCase,
}: {
  casePoints: DashboardCasePoint[]
  selectedRegion: string
  openCase: (caseRecord: DashboardCasePoint) => void
}) {
  const zimbabweBounds: LatLngBoundsExpression = [[-22.8, 24.5], [-15.2, 33.4]]
  return (
    <div className="h-[420px] overflow-hidden border-t border-[#edf0f4] bg-[#eef2f5]">
      <MapContainer className="h-full w-full" center={[-19.0, 29.8]} zoom={6.4} minZoom={6} maxZoom={10} maxBounds={zimbabweBounds} maxBoundsViscosity={1} scrollWheelZoom>
        <MapFocus selectedRegion={selectedRegion} />
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Street map">
            <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Light detail">
            <TileLayer attribution="&copy; CARTO &copy; OpenStreetMap" url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
          </LayersControl.BaseLayer>
          <LayersControl.Overlay checked name="Submitted and approved cases">
            <LayerGroup>
              {casePoints.map((point) => {
                const color = point.priority === "High" ? "#ff5058" : point.priority === "Medium" ? "#f59e0b" : "#008c7a"
                return (
                  <CircleMarker
                    key={point.id}
                    center={[point.lat + point.offset, point.lng + point.offset]}
                    radius={point.priority === "High" ? 7 : 5}
                    pathOptions={{ color, fillColor: color, fillOpacity: 0.82, weight: 2 }}
                    eventHandlers={{ click: () => openCase(point) }}
                  >
                    <Popup>
                      <strong>{point.id}</strong>
                      <br />
                      {point.concern}
                      <br />
                      {point.district} | {point.status} | {point.priority}
                    </Popup>
                  </CircleMarker>
                )
              })}
            </LayerGroup>
          </LayersControl.Overlay>
        </LayersControl>
      </MapContainer>
    </div>
  )
}

function MapFocus({ selectedRegion }: { selectedRegion: string }) {
  const map = useMap()
  useEffect(() => {
    const nationalBounds: LatLngBoundsExpression = [[-22.8, 24.5], [-15.2, 33.4]]
    const region = zimbabweRegions.find((item) => item.name === selectedRegion)
    map.fitBounds(region ? region.positions : nationalBounds, { padding: [24, 24], animate: true })
  }, [map, selectedRegion])
  return null
}

function Dashboard({ title, metrics, alerts, limited = false }: { title: string; metrics: Metric[]; alerts: AlertRecord[]; limited?: boolean }) {
  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-3">
        {metrics.map((metric) => {
          const Icon = metric.icon
          return (
            <article key={metric.label} className="flex min-h-[94px] items-center gap-4 rounded-md bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
              <div className={`grid h-12 w-12 place-items-center rounded-md text-white ${metric.tone}`}><Icon className="h-6 w-6" /></div>
              <div><div className="text-[28px] font-bold leading-none text-[#263747]">{metric.value}</div><div className="mt-1 text-[13px] text-[#64748b]">{metric.label}</div></div>
            </article>
          )
        })}
      </section>
      <Panel title={title} icon={LayoutDashboard}>
        <AlertTable alerts={alerts} limited={limited} />
      </Panel>
    </div>
  )
}

function AlertsInbox({ alerts, selectedId, setSelectedAlertId, setView }: { alerts: AlertRecord[]; selectedId: string; setSelectedAlertId: (id: string) => void; setView: (view: string) => void }) {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("Immediate Action Required")
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [page, setPage] = useState(1)
  const preferredStatuses = ["Immediate Action Required", "All", "Intake In Progress"]
  const remainingStatuses = Array.from(new Set(alerts.flatMap((alert) => [alert.internalStatus, alert.status]).filter(Boolean))).sort()
  const statusOptions = [...preferredStatuses, ...remainingStatuses.filter((status) => !preferredStatuses.includes(status))]
  const visibleAlerts = alerts.filter((alert) => {
    const haystack = [alert.id, alert.childName, alert.district, alert.reporterType, alert.concern, alert.internalStatus, alert.status, alert.danger.join(" ")].join(" ").toLowerCase()
    const matchesSearch = !search.trim() || haystack.includes(search.trim().toLowerCase())
    const matchesStatus = statusFilter === "All" || alert.internalStatus === statusFilter || alert.status === statusFilter
    return matchesSearch && matchesStatus
  })
  const pageCount = Math.max(1, Math.ceil(visibleAlerts.length / rowsPerPage))
  const safePage = Math.min(page, pageCount)
  const pageRows = visibleAlerts.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage)
  const pageStart = visibleAlerts.length ? (safePage - 1) * rowsPerPage + 1 : 0
  const pageEnd = Math.min(visibleAlerts.length, safePage * rowsPerPage)

  useEffect(() => setPage(1), [search, statusFilter, rowsPerPage])

  return (
    <Panel title="Alerts Inbox" icon={Inbox} action={`${visibleAlerts.length} records`}>
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(260px,1fr)_280px]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
          <input className={`${inputClass} h-11 w-full pl-10`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search alerts..." />
        </label>
        <label className="relative block">
          <select className={`${inputClass} h-11 w-full appearance-none pr-10 font-semibold text-[#263747]`} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter alerts by status">
            {statusOptions.map((item) => <option key={item}>{item}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
        </label>
      </div>
      <div className="overflow-hidden rounded-md border border-[#d8dee8] bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1460px] border-collapse text-left text-sm">
          <thead className="bg-[#f8fafc] text-[#2e6fa3]">
            <tr>{["Alert ID", "Child", "Sex", "Age", "District", "Reporter", "Concerns", "Status", "Danger factors", "Date submitted", "Officer", "Actions"].map((h) => <th key={h} className="border-b border-[#d8dee8] px-3 py-3">{h}</th>)}</tr>
          </thead>
          <tbody>
            {pageRows.length ? pageRows.map((alert) => (
              <tr key={alert.id} className={selectedId === alert.id ? "bg-[#e7f6f3]" : "bg-white"}>
                <td className="border-b border-[#edf0f4] px-3 py-3 font-semibold">
                  <button className="text-left font-bold text-[#30528c] underline-offset-2 hover:text-[#008c7a] hover:underline" onClick={() => { setSelectedAlertId(alert.id); setView("triage") }}>
                    {alert.id}
                  </button>
                </td>
                <td className="border-b border-[#edf0f4] px-3 py-3">{alert.childName}</td>
                <td className="border-b border-[#edf0f4] px-3 py-3">{alert.sex}</td>
                <td className="border-b border-[#edf0f4] px-3 py-3">{alert.age}</td>
                <td className="border-b border-[#edf0f4] px-3 py-3">{alert.district}</td>
                <td className="border-b border-[#edf0f4] px-3 py-3">{alert.reporterType}</td>
                <td className="border-b border-[#edf0f4] px-3 py-3">
                  <div className="flex max-w-[360px] flex-wrap gap-1.5">
                    {alertConcerns(alert).map((item) => <span key={item} className="rounded-full bg-[#e7f0fb] px-2 py-1 text-[11px] font-bold text-[#2e6fa3]">{item}</span>)}
                  </div>
                </td>
                <td className="border-b border-[#edf0f4] px-3 py-3">{alert.internalStatus}</td>
                <td className="border-b border-[#edf0f4] px-3 py-3 min-w-[280px] max-w-[340px]">
                  {alert.danger.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {alert.danger.slice(0, 2).map((item) => <span key={item} className="rounded-full bg-[#fee4e2] px-2 py-1 text-[11px] font-bold text-[#b42318]">{item}</span>)}
                      {alert.danger.length > 2 && <span className="rounded-full bg-[#fff4d6] px-2 py-1 text-[11px] font-bold text-[#a05b16]">+{alert.danger.length - 2} more</span>}
                    </div>
                  ) : "No"}
                </td>
                <td className="whitespace-nowrap border-b border-[#edf0f4] px-3 py-3">{alert.submittedAt || "-"}</td>
                <td className="border-b border-[#edf0f4] px-3 py-3">{alert.intakeOfficer || "-"}</td>
                <td className="border-b border-[#edf0f4] px-3 py-3">
                  <button className="grid h-9 w-9 place-items-center rounded-md bg-[#008c7a] text-white hover:bg-[#007464]" onClick={() => { setSelectedAlertId(alert.id); setView("triage") }} aria-label={`View alert ${alert.id}`} title="View alert details">
                    <Eye className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={12}>No alerts match the selected filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <TablePagination
        totalRows={visibleAlerts.length}
        pageStart={pageStart}
        pageEnd={pageEnd}
        rowsPerPage={rowsPerPage}
        setRowsPerPage={setRowsPerPage}
        page={safePage}
        pageCount={pageCount}
        setPage={setPage}
      />
      </div>
    </Panel>
  )
}

function isImmediateAttentionAlert(alert: AlertRecord) {
  const statusText = `${alert.status} ${alert.internalStatus}`.toLowerCase()
  return alert.emergency || alert.danger.length > 0 || statusText.includes("immediate") || statusText.includes("more information")
}

function TablePagination({
  totalRows,
  pageStart,
  pageEnd,
  rowsPerPage,
  setRowsPerPage,
  page,
  pageCount,
  setPage,
}: {
  totalRows: number
  pageStart: number
  pageEnd: number
  rowsPerPage: number
  setRowsPerPage: (value: number) => void
  page: number
  pageCount: number
  setPage: (updater: (current: number) => number) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d8dee8] bg-[#f8fafc] px-3 py-3 text-sm text-[#475569]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold text-[#263747]">Rows {pageStart}-{pageEnd} of {totalRows}</span>
        <label className="flex items-center gap-2 font-semibold">
          Show
          <select className="h-9 rounded-md border border-[#d8dee8] bg-white px-2 text-[#263747]" value={rowsPerPage} onChange={(event) => setRowsPerPage(Number(event.target.value))}>
            {[10, 25, 50].map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 font-semibold text-[#263747] disabled:cursor-not-allowed disabled:opacity-45" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
        <span className="rounded-md bg-white px-3 py-2 font-semibold text-[#263747]">Page {page} of {pageCount}</span>
        <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 font-semibold text-[#263747] disabled:cursor-not-allowed disabled:opacity-45" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</button>
      </div>
    </div>
  )
}

function ExternalTracking({ alerts }: { alerts: AlertRecord[] }) {
  return (
    <Panel title="My Submitted Alerts" icon={History} action="Limited status view">
      <AlertTable alerts={alerts} limited />
    </Panel>
  )
}

function AlertTable({ alerts, limited }: { alerts: AlertRecord[]; limited?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-md border border-[#d8dee8]">
      <table className="w-full min-w-[800px] border-collapse bg-white text-left text-sm">
        <thead className="bg-[#f8fafc] text-[#2e6fa3]">
          <tr>{["Reference", "Submitted", "Child", "District", "Concern", "Status", limited ? "Feedback" : "Internal state"].map((h) => <th key={h} className="border-b border-[#d8dee8] px-4 py-3">{h}</th>)}</tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert.id}>
              <td className="border-b border-[#edf0f4] px-4 py-3 font-semibold">{alert.id}</td>
              <td className="border-b border-[#edf0f4] px-4 py-3">{alert.submittedAt}</td>
              <td className="border-b border-[#edf0f4] px-4 py-3">{alert.childName}</td>
              <td className="border-b border-[#edf0f4] px-4 py-3">{alert.district}</td>
              <td className="border-b border-[#edf0f4] px-4 py-3">{alert.concern}</td>
              <td className="border-b border-[#edf0f4] px-4 py-3"><StatusBadge status={alert.status} /></td>
              <td className="border-b border-[#edf0f4] px-4 py-3 text-[#64748b]">{limited ? publicAlertFeedback(alert) : alert.internalStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function publicAlertFeedback(alert: AlertRecord) {
  if (alert.status === "Rejected" || alert.internalStatus === "Alert Rejected") return "The alert was reviewed and rejected. Contact the district office if you believe this needs correction."
  if (alert.status === "More Information Requested") return "More information is requested. Please check requests and respond."
  if (alert.status === "Converted to Case" || alert.status === "Intake In Progress") return "The alert has been converted to an intake/case and is being handled by the responsible office."
  if (alert.status === "Emergency Response Initiated" || alert.emergency) return "Emergency response is in progress. The responsible office has been notified."
  if (alert.status === "Duplicate / Already Known") return "The alert is being reviewed as a possible duplicate."
  if (alert.status === "Referred to Relevant Office") return "The alert has been referred to the relevant office."
  if (alert.status === "Closed - No Further Action") return "The alert was reviewed and closed with no further action."
  return "Submitted. The district office will review and update the status."
}

function Summary({ alert, action }: { alert: AlertRecord; action?: ReactNode }) {
  const concerns = alertConcerns(alert)
  return (
    <div className="rounded-md border border-[#d8dee8] bg-white p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><div className="text-lg font-bold text-[#263747]">{alert.id}</div><div className="text-sm text-[#64748b]">{alert.submittedAt} | {alert.reporterType}</div></div>
        <div className="flex items-center gap-2">
          <StatusBadge status={alert.status} />
          {action}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Info label="Child" value={`${alert.childName} (${alert.sex}, ${alert.age})`} />
        <Info label="Location" value={`${alert.district}, ${alert.ward}`} />
        <Info label="Intake officer" value={alert.intakeOfficer || "Unassigned"} />
        <Info label="Submitted by" value={submittedByLabel(alert)} />
        <Info label="Reporting channel" value={alert.reporting_channel || alert.reporterType || "Not captured"} />
        <Info label="Information source" value={sourceTypeLabel(alert)} />
        <Info label="Source name" value={alert.protect_source_identity ? "Protected" : alert.information_source_name || "Not captured"} />
        <Info label="Source contact" value={alert.protect_source_identity ? "Protected" : alert.information_source_contact || "Not captured"} />
        <Info label="Alternative contact" value={alert.alternative_contact || "Not captured"} />
        <Info label="Relationship to child" value={alert.information_source_relationship_to_child || "Not captured"} />
      </div>
      <div className="mt-4 rounded-md border border-[#d8dee8] bg-[#f8fafc] p-3">
        <div className="mb-2 text-xs font-bold uppercase text-[#64748b]">Selected concerns</div>
        <div className="flex flex-wrap gap-2">
          {concerns.length ? concerns.map((item) => <span key={item} className="rounded-full bg-[#e7f0fb] px-3 py-1 text-xs font-bold text-[#2e6fa3]">{item}</span>) : <span className="text-sm text-[#64748b]">No concern categories captured.</span>}
        </div>
      </div>
      <div className="mt-4 rounded-md border border-[#f4b4ac] bg-[#fff7f5] p-3">
        <div className="mb-2 text-xs font-bold uppercase text-[#b42318]">Immediate danger screening</div>
        <div className="flex flex-wrap gap-2">
          {alert.danger.length ? alert.danger.map((item) => <span key={item} className="rounded-full bg-[#fee4e2] px-3 py-1 text-xs font-bold text-[#b42318]">{item}</span>) : <span className="text-sm text-[#64748b]">No danger factors selected.</span>}
        </div>
      </div>
      <div className="mt-4 rounded-md border border-[#b7d7f3] bg-[#f4f9ff] p-4">
        <div className="mb-2 text-xs font-bold uppercase text-[#2e6fa3]">Reporter narrative</div>
        <p className="whitespace-pre-wrap text-sm leading-6 text-[#475569]">{alert.description || "No detailed incident description captured yet."}</p>
      </div>
      {alert.source_brief_description && (
        <div className="mt-3 rounded-md border border-[#d8dee8] bg-white p-4">
          <div className="mb-2 text-xs font-bold uppercase text-[#64748b]">Brief source description</div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-[#475569]">{alert.source_brief_description}</p>
        </div>
      )}
    </div>
  )
}

function AlertCapturedDetails({ alert }: { alert: AlertRecord }) {
  const empty = "Not captured"
  const protectedValue = (value?: string) => alert.protect_source_identity ? "Protected" : value || empty
  const sections = [
    {
      title: "Child Details",
      fields: [
        ["First name", alert.child_first_name || alert.childName.split(" ").slice(0, -1).join(" ") || alert.childName || empty],
        ["Surname", alert.child_surname || alert.childName.split(" ").slice(-1)[0] || empty],
        ["Sex", alert.sex || empty],
        ["Age", alert.age || empty],
        ["Child known", alert.childName.toLowerCase().includes("unknown") ? "No" : "Yes"],
        ["Birth registered", alert.birth_registered || empty],
        ["Birth certificate number", alert.birth_certificate_number || empty],
        ["Disability", alert.disability || empty],
      ],
    },
    {
      title: "Location",
      fields: [
        ["District", alert.district || empty],
        ["Ward", alert.ward || empty],
        ["Village / suburb", alert.village_suburb || empty],
        ["Current location", alert.current_location || alert.district || empty],
        ["Nearest landmark", alert.nearest_landmark || empty],
      ],
    },
    {
      title: "Reporter & Information Source",
      fields: [
        ["Submitted by", submittedByLabel(alert)],
        ["Reporter role", alert.reporterType || empty],
        ["Intake source", alert.intake_source || "ALERT"],
        ["Reporting channel", alert.reporting_channel || empty],
        ["Information source type", sourceTypeLabel(alert)],
        ["Source name", protectedValue(alert.information_source_name)],
        ["Source contact", protectedValue(alert.information_source_contact)],
        ["Alternative contact", alert.alternative_contact || empty],
        ["Relationship to child", alert.information_source_relationship_to_child || alert.relationship_to_child || empty],
        ["Protect source identity", alert.protect_source_identity ? "Yes" : "No"],
        ["Source brief description", alert.source_brief_description || empty],
      ],
    },
    {
      title: "Caregiver / Household",
      fields: [
        ["Caregiver name", alert.caregiver_name || empty],
        ["Caregiver contact", alert.caregiver_contact || empty],
        ["Relationship to child", alert.relationship_to_child || empty],
        ["Protect caregiver identity", alert.protect_reporter_identity ? "Yes" : "No"],
      ],
    },
    {
      title: "Incident & Action Already Taken",
      fields: [
        ["Incident date", alert.incident_date || empty],
        ["Date reporter became aware", alert.date_reporter_became_aware || empty],
        ["Incident location", alert.incident_location || empty],
        ["Alleged perpetrator name", alert.alleged_perpetrator_name || empty],
        ["Alleged perpetrator relationship", alert.alleged_perpetrator_relationship || empty],
        ["Perpetrator has access", alert.perpetrator_has_access || empty],
        ["Immediate action taken", alert.immediate_action_taken || empty],
        ["Services contacted", alert.services_contacted || empty],
      ],
    },
  ]

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <section key={section.title} className="rounded-md border border-[#d8dee8] bg-white p-4">
          <h3 className="mb-3 text-base font-bold text-[#263747]">{section.title}</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {section.fields.map(([label, value]) => <Info key={`${section.title}-${label}`} label={label} value={value || empty} />)}
          </div>
        </section>
      ))}
    </div>
  )
}

function WorkflowActions({ title, actions, onAction }: { title: string; actions: [string, Partial<AlertRecord>][]; onAction: (changes: Partial<AlertRecord>) => void }) {
  return (
    <aside className="rounded-md border border-[#d8dee8] bg-white p-4">
      <h3 className="mb-3 font-bold text-[#263747]">{title}</h3>
      <div className="space-y-2">
        {actions.map(([label, changes]) => <ActionButton key={label} label={label} onClick={() => onAction(changes)} />)}
      </div>
    </aside>
  )
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="flex w-full items-center justify-between rounded-md border border-[#d8dee8] px-3 py-2 text-left text-sm font-semibold hover:border-[#008c7a] hover:bg-[#e7f6f3]" onClick={onClick}>
      {label}<ArrowRight className="h-4 w-4" />
    </button>
  )
}

function PortalHeader({
  title,
  subtitle,
  onSwitch,
  switchLabel,
  user,
  onLogout,
}: {
  title: string
  subtitle: string
  onSwitch: () => void
  switchLabel: string
  user?: ApiUser | null
  onLogout?: () => void
}) {
  return (
    <header className="border-b border-[#d8dee8] bg-white">
      <div className="mx-auto flex min-h-[84px] max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-md bg-[#263747] text-white"><Shield className="h-7 w-7" /></div>
          <div><h1 className="text-2xl font-bold text-[#263747]">{title}</h1><p className="text-sm text-[#64748b]">{subtitle}</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {user && <span className="rounded-full bg-[#f1f5f9] px-3 py-2 text-sm font-semibold text-[#263747]">{user.username} | {user.profile.roleLabel}</span>}
          {user && onLogout && <button className="h-10 rounded-md border border-[#d8dee8] px-4 text-sm font-semibold text-[#27364d]" onClick={onLogout}>Logout</button>}
          <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={onSwitch}><LogIn className="h-4 w-4" /> {switchLabel}</button>
        </div>
      </div>
    </header>
  )
}

function SideNav({ title, active, setActive, items }: { title: string; active: string; setActive: (value: string) => void; items: [string, string, ElementType][] }) {
  return (
    <aside className="h-fit rounded-md bg-[#263747] p-3 text-white shadow-sm">
      <div className="px-3 py-3 text-sm font-bold uppercase text-white/70">{title}</div>
      <nav className="space-y-1">
        {items.map(([key, label, Icon]) => (
          <button key={key} className={`flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold ${active === key ? "bg-[#008c7a]" : "text-white/88 hover:bg-white/10"}`} onClick={() => setActive(key)}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </nav>
    </aside>
  )
}

function InternalSideNav({ active, setActive, user, collapsed, onToggle }: { active: string; setActive: (value: string) => void; user: ApiUser; collapsed: boolean; onToggle: () => void }) {
  type NavChild = [string, string, ElementType?]
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const activeNav = active === "triage" ? "case-alerts" : active
  const isDistrictHead = user.profile.role === "DISTRICT_HEAD"
  const groups = [
    {
      label: "Case Management",
      icon: File,
      children: [
        ["case-alerts", "Case Alert"],
        ["case-intake", "Case Intake & Screening"],
        ["review", "Submitted Cases"],
        ...(isDistrictHead ? [["update-requests", "Update Requests"] as NavChild] : []),
        ...(isDistrictHead ? [["allocation", "Unallocated Cases"] as NavChild] : []),
        ["allocated-cases", "Allocated Cases"],
      ],
    },
    {
      label: "Partner Management",
      icon: File,
      children: [["partners", "Partners"]],
    },
    {
      label: "Services Management",
      icon: File,
      children: [["services", "Services"]],
    },
    {
      label: "Places of Safety",
      icon: File,
      children: [["places", "Places of Safety"]],
    },
    {
      label: "Case Events Management",
      icon: File,
      children: [["events", "Case Events"]],
    },
    {
      label: "Reports & Analytics",
      icon: BarChart3,
      children: [["reports", "Reports & Analytics"], ["audit", "Audit Logs"]],
    },
    {
      label: "Settings",
      icon: Settings,
      children: [["setup", "User Management"]],
    },
    {
      label: "System",
      icon: Monitor,
      children: [["system", "System Overview"]],
    },
    {
      label: "My Collaboration",
      icon: PencilLine,
      children: [["collaboration", "Collaboration"]],
    },
  ] satisfies Array<{ label: string; icon: ElementType; children: NavChild[] }>
  const placeholders = new Set(["partners", "services", "places", "events", "system", "collaboration"])
  function toggleGroup(label: string) {
    setExpandedGroups((items) => (items.includes(label) ? items.filter((item) => item !== label) : [...items, label]))
  }

  return (
    <aside className="min-h-full overflow-hidden bg-[#3c4866] text-white shadow-sm">
      <div className={`flex h-[60px] items-center bg-[#24384d] ${collapsed ? "justify-center px-2" : "justify-between px-5"}`}>
        {!collapsed && (
          <div className="flex flex-1 items-center justify-center gap-2">
            <img className="h-9 w-9 object-contain" src={coatOfArms} alt="National coat of arms" />
            <div className="font-serif text-[26px] font-bold italic leading-none tracking-wide">ICMS</div>
          </div>
        )}
        <button className="grid h-9 w-9 place-items-center" onClick={onToggle} aria-label="Collapse sidebar">
          <Menu className="h-5 w-5" />
        </button>
      </div>
      {!collapsed && <div className="border-t border-white/70 px-5 py-3">
        <div className="text-[15px] font-bold">{user.first_name || user.username}</div>
        <div className="mt-3 flex items-center gap-2 text-[14px]"><span className="h-3 w-3 rounded-full bg-[#7bd998]" /> Online</div>
      </div>}
      {!collapsed && <div className="px-3 pb-4">
        <label className="flex h-10 items-center rounded-sm bg-[#56637d] text-white/80">
          <input className="min-w-0 flex-1 bg-transparent px-3 text-[13px] outline-none placeholder:text-white/60" placeholder="Search..." />
          <Search className="mr-3 h-4 w-4 text-[#d4b67a]" />
        </label>
      </div>}
      {!collapsed && <div className="px-7 pb-3 text-[12px] font-bold uppercase text-white drop-shadow">Navigation Menu</div>}
      <nav>
        <button
          className={`flex h-11 w-full items-center gap-3 border-l-4 ${collapsed ? "justify-center px-0" : "px-5"} text-left text-[14px] font-semibold ${activeNav === "dashboard" ? "border-[#23d3c0] bg-[#33405b]" : "border-transparent hover:bg-[#33405b]"}`}
          onClick={() => setActive("dashboard")}
          title="Dashboard"
        >
          <LayoutDashboard className="h-4 w-4" /> {!collapsed && "Dashboard"}
        </button>
        {groups.map((group) => {
          const GroupIcon = group.icon
          const groupActive = group.children.some(([key]) => key === activeNav)
          const expanded = expandedGroups.includes(group.label)
          return (
            <div key={group.label}>
              <button
                className={`flex h-11 w-full items-center border-l-4 ${collapsed ? "justify-center px-0" : "justify-between px-5"} text-left text-[14px] font-semibold ${groupActive ? "border-[#23d3c0] bg-[#33405b]" : "border-transparent hover:bg-[#33405b]"}`}
                onClick={() => (collapsed ? setActive(group.children[0][0]) : toggleGroup(group.label))}
                title={group.label}
              >
                <span className="flex items-center gap-2"><GroupIcon className="h-4 w-4" /> {!collapsed && group.label}</span>
                {!collapsed && <ChevronDown className={`h-4 w-4 text-white/70 transition-transform ${expanded ? "rotate-180" : ""}`} />}
              </button>
              {!collapsed && expanded && group.children.map(([key, label]) => (
                <button
                  key={key}
                  className={`flex h-10 w-full items-center border-l-4 pl-12 pr-4 text-left text-[13px] ${activeNav === key ? "border-[#23d3c0] bg-[#56637d] text-white" : "border-transparent bg-[#3a4663] text-white hover:bg-[#4b5874]"}`}
                  onClick={() => setActive(placeholders.has(key) ? key : key)}
                >
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )
        })}
      </nav>
      {!collapsed && <div className="px-5 py-6 text-xs text-white/55">{user.username} | {user.profile.roleLabel}</div>}
    </aside>
  )
}

function InternalTopBar({ currentView, user, alerts, onNotifications, onLogout, onProfile }: { currentView: string; user: ApiUser; alerts: AlertRecord[]; onNotifications: () => void; onLogout: () => void; onProfile: () => void }) {
  const [open, setOpen] = useState(false)
  const notificationCount = alerts.filter(isActiveInternalNotification).length
  const pageTitles: Record<string, string> = {
    dashboard: "Dashboard",
    "case-alerts": "Case Alert",
    triage: "Alert Triage",
    "captured-cases": "Captured Cases",
    "case-intake": "Case Intake & Screening",
    "new-intake": "Case Intake",
    intake: "Case Intake",
    screening: "Initial Screening",
    review: "Submitted Cases",
    "update-requests": "Update Requests",
    allocation: "Unallocated Cases",
    "allocated-cases": "Allocated Cases",
    reports: "Reports & Analytics",
    audit: "Audit Logs",
    notifications: "Notifications",
    setup: "User Management",
    "internal-profile": "Profile",
    partners: "Partners",
    services: "Services",
    places: "Places of Safety",
    events: "Case Events",
    system: "System Overview",
    collaboration: "Collaboration",
  }
  const currentPage = pageTitles[currentView] || "Dashboard"

  return (
    <>
      <div className="flex h-[58px] items-center justify-between bg-white px-4 text-[#4b4f56] shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-7 w-1 rounded-full bg-[#008c7a]" />
          <div className="min-w-0">
            <div className="text-[18px] font-bold leading-tight text-[#263747]">{currentPage}</div>
            <div className="text-[12px] font-semibold uppercase text-[#64748b]">NCMIS workspace</div>
          </div>
        </div>
        <div className="flex items-center gap-7">
          <button className="relative grid h-8 min-w-5 place-items-center" title="Notifications" onClick={onNotifications}>
            {notificationCount > 0 && <span className="absolute -right-2 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#ef5350] px-1 text-[11px] font-bold text-white">{notificationCount}</span>}
            <Bell className="h-5 w-5" />
          </button>
          <div className="relative">
            <button className="flex items-center gap-2 text-[15px] font-bold" title={`${user.username} | ${user.profile.roleLabel}`} onClick={() => setOpen((value) => !value)}>
            <UserCheck className="h-5 w-5" />
            <span>{user.first_name || user.username}</span>
            <ChevronDown className="h-4 w-4" />
            </button>
            {open && (
              <div className="absolute right-0 top-10 z-20 w-56 rounded-sm border border-[#d8dee8] bg-white py-2 shadow-lg">
                <button className="block w-full px-4 py-2 text-left text-[14px] text-[#263747] hover:bg-[#f1f5f9]" onClick={() => { onProfile(); setOpen(false) }}>Profile</button>
                <div className="border-t border-[#edf0f4] px-4 py-2 text-[12px] text-[#64748b]">{user.username} | {user.profile.roleLabel}</div>
                <button className="block w-full px-4 py-2 text-left text-[14px] font-semibold text-[#b42318] hover:bg-[#fef2f2]" onClick={onLogout}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="h-[17px] bg-[#24384d]" />
    </>
  )
}

type ReportChartRow = { name?: string; month?: string; value: number }
type ReportsPayload = {
  generatedAt: string
  scope: string
  summary: {
    totalAlerts: number
    totalIntakes: number
    allocatedCases: number
    highRiskAlerts: number
    overdueAssessments: number
    completedAssessments: number
    averageAllocationDelaySeconds: number | null
    averageAllocationDelayLabel: string
  }
  charts: {
    casesByProvince: ReportChartRow[]
    casesByDistrict: ReportChartRow[]
    caseStatus: ReportChartRow[]
    riskDistribution: ReportChartRow[]
    concernDistribution: ReportChartRow[]
    monthlyTrend: ReportChartRow[]
    assessmentStatus: ReportChartRow[]
    funnel: ReportChartRow[]
  }
  tables: {
    officerWorkload: Array<Record<string, string | number>>
    districtPerformance: Array<Record<string, string | number>>
  }
}

function ReportsAnalytics({ user, alerts, cases, users, districts, provinces }: { user: ApiUser; alerts: AlertRecord[]; cases: CaseRecord[]; users: ApiUser[]; districts: DistrictOption[]; provinces: ProvinceOption[] }) {
  const reportSections = [
    "Executive Dashboard",
    "Staff Allocation Load",
    "CCW Monthly Case Summary",
    "Case Statistics",
    "Risk & Abuse Trends",
    "Intake & Screening Reports",
    "Assessment Reports",
    "Referrals & Services Reports",
    "Case Review & Closure Reports",
    "Officer Performance Reports",
    "Geographic Reports",
    "Custom Report Builder",
    "Generated Reports",
  ]
  const [activeSection, setActiveSection] = useState(reportSections[0])
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [data, setData] = useState<ReportsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const query = new URLSearchParams()
  if (startDate) query.set("start", startDate)
  if (endDate) query.set("end", endDate)
  const queryString = query.toString() ? `?${query.toString()}` : ""

  useEffect(() => {
    let cancelled = false
    async function loadReports() {
      setLoading(true)
      setError("")
      try {
        const payload = await apiGet<ReportsPayload>(`/reports/analytics/${queryString}`)
        if (!cancelled) setData(payload)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load reports.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadReports()
    return () => {
      cancelled = true
    }
  }, [queryString])

  async function downloadReport(format: "excel" | "pdf") {
    const token = window.sessionStorage.getItem("ncms_access_token")
    const response = await fetch(`/api/reports/export/${format}/${queryString}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!response.ok) {
      setError(`Could not generate ${format.toUpperCase()} report.`)
      return
    }
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `ncms-report.${format === "excel" ? "xlsx" : "pdf"}`
    link.click()
    window.URL.revokeObjectURL(url)
  }

  const charts = data?.charts
  const summary = data?.summary
  const districtRows = data?.tables.districtPerformance || []
  const officerRows = data?.tables.officerWorkload || []

  return (
    <div className="space-y-4">
      <Panel title="Reports & Analytics" icon={BarChart3} action={`${user.profile.roleLabel} scope`}>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {reportSections.map((section) => (
              <button key={section} className={`h-10 rounded-md border px-3 text-sm font-semibold ${activeSection === section ? "border-[#008c7a] bg-[#008c7a] text-white" : "border-[#d8dee8] bg-white text-[#263747]"}`} onClick={() => setActiveSection(section)}>
                {section}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="From"><input className={inputClass} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></Field>
            <Field label="To"><input className={inputClass} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></Field>
            <button className="h-11 rounded-md border border-[#d8dee8] bg-white px-4 text-sm font-semibold text-[#263747]" onClick={() => downloadReport("excel")}>Excel</button>
            <button className="h-11 rounded-md bg-[#263747] px-4 text-sm font-semibold text-white" onClick={() => downloadReport("pdf")}>PDF</button>
          </div>
        </div>
        {error && <ErrorBanner message={error} />}
        {loading && <Notice text="Loading report data..." />}
        {summary && (
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <MiniCard title="Alerts" value={`${summary.totalAlerts}`} icon={Inbox} />
            <MiniCard title="Intakes" value={`${summary.totalIntakes}`} icon={ClipboardCheck} />
            <MiniCard title="Allocated" value={`${summary.allocatedCases}`} icon={UserCheck} />
            <MiniCard title="High Risk" value={`${summary.highRiskAlerts}`} icon={ShieldAlert} />
            <MiniCard title="Overdue Assessments" value={`${summary.overdueAssessments}`} icon={Clock3} />
            <MiniCard title="Avg Allocation Delay" value={summary.averageAllocationDelayLabel} icon={CalendarDays} />
          </div>
        )}
      </Panel>

      {activeSection === "Staff Allocation Load" && (
        <StaffAllocationLoadReport user={user} alerts={alerts} cases={cases} users={users} districts={districts} provinces={provinces} />
      )}

      {activeSection === "CCW Monthly Case Summary" && (
        <CcwMonthlyCaseSummaryReport user={user} alerts={alerts} users={users} districts={districts} provinces={provinces} />
      )}

      {!["Staff Allocation Load", "CCW Monthly Case Summary"].includes(activeSection) && charts && (
        <div className="grid gap-4 xl:grid-cols-2">
          <ReportChart title="Monthly Case Trend" option={lineOption(charts.monthlyTrend, "month")} />
          <ReportChart title="Cases by District" option={barOption(charts.casesByDistrict)} />
          <ReportChart title="Risk Distribution" option={pieOption(charts.riskDistribution)} />
          <ReportChart title="Assessment Completion" option={pieOption(charts.assessmentStatus)} />
          <ReportChart title="Intake to Closure Funnel" option={funnelOption(charts.funnel)} />
          <ReportChart title="Case Categories" option={barOption(charts.concernDistribution)} />
        </div>
      )}

      {!["Staff Allocation Load", "CCW Monthly Case Summary"].includes(activeSection) && data && (
        <div className="grid gap-4 xl:grid-cols-2">
          <ReportTable title="District Performance Report" rows={districtRows} />
          <ReportTable title="Officer Workload Report" rows={officerRows} />
        </div>
      )}
    </div>
  )
}

function StaffAllocationLoadReport({ user, alerts, cases, users, districts, provinces }: { user: ApiUser; alerts: AlertRecord[]; cases: CaseRecord[]; users: ApiUser[]; districts: DistrictOption[]; provinces: ProvinceOption[] }) {
  const isNationalUser = ["SYS_ADMIN", "DEPUTY_DIRECTOR", "DIRECTOR", "PROGRAMME_OFFICER"].includes(user.profile.role)
  const isProvincialHead = user.profile.role === "PROVINCIAL_HEAD"
  const isDistrictHead = user.profile.role === "DISTRICT_HEAD"
  const rows = buildDistrictHeadRows(alerts, cases).filter((row) => row.status === "Allocated" || Boolean(row.allocatedOfficer))
  const provinceOptions = provinces.length ? provinces : Array.from(new Map(districts.map((district) => [district.province, { id: district.province, name: district.provinceName }])).values())
  const defaultProvince = isProvincialHead ? user.profile.provinceName : isDistrictHead ? districts.find((district) => district.name === user.profile.districtName)?.provinceName || "" : provinceOptions[0]?.name || ""
  const [selectedProvince, setSelectedProvince] = useState(defaultProvince)
  const provinceDistricts = districts.filter((district) => !selectedProvince || district.provinceName === selectedProvince)
  const defaultDistrict = isDistrictHead ? user.profile.districtName : provinceDistricts[0]?.name || ""
  const [selectedDistrict, setSelectedDistrict] = useState(defaultDistrict)
  const [selectedOfficer, setSelectedOfficer] = useState("")

  useEffect(() => {
    if (isDistrictHead) {
      setSelectedDistrict(user.profile.districtName)
      return
    }
    const nextDistricts = districts.filter((district) => !selectedProvince || district.provinceName === selectedProvince)
    if (!nextDistricts.some((district) => district.name === selectedDistrict)) {
      setSelectedDistrict(nextDistricts[0]?.name || "")
      setSelectedOfficer("")
    }
  }, [selectedProvince, districts.length, user.profile.districtName])

  const scopedRows = rows.filter((row) => {
    const provinceName = provinceNameForCase(row, districts)
    if (isNationalUser && selectedProvince && provinceName !== selectedProvince) return false
    if (isProvincialHead && user.profile.provinceName && provinceName !== user.profile.provinceName) return false
    if (selectedDistrict && row.district !== selectedDistrict) return false
    if (isDistrictHead && user.profile.districtName && row.district !== user.profile.districtName) return false
    return true
  })

  const districtOfficers = users.filter((item) => item.profile.role === "DSDO" && (!selectedDistrict || item.profile.districtName === selectedDistrict))
  const officerKeys = new Map<string, { key: string; name: string; role: string; district: string; cases: DistrictHeadCaseRow[] }>()
  districtOfficers.forEach((officer) => {
    const name = [officer.first_name, officer.last_name].filter(Boolean).join(" ") || officer.username
    officerKeys.set(officer.username, { key: officer.username, name, role: officer.profile.roleLabel, district: officer.profile.districtName || selectedDistrict || "Not assigned", cases: [] })
  })
  scopedRows.forEach((row) => {
    const officer = allocatedOfficerUser(row, users)
    const key = officer?.username || row.allocatedOfficer || "Unassigned"
    const name = officer ? [officer.first_name, officer.last_name].filter(Boolean).join(" ") || officer.username : row.allocatedOfficer || "Unassigned"
    const existing = officerKeys.get(key) || { key, name, role: officer?.profile.roleLabel || "Case officer", district: row.district, cases: [] }
    existing.cases.push(row)
    officerKeys.set(key, existing)
  })
  const officerRows = Array.from(officerKeys.values()).sort((a, b) => b.cases.length - a.cases.length || a.name.localeCompare(b.name))
  const activeOfficer = officerRows.find((officer) => officer.key === selectedOfficer) || officerRows[0]
  const totalAllocated = scopedRows.length
  const overloaded = officerRows.filter((officer) => officer.cases.length >= 20).length
  const idle = officerRows.filter((officer) => officer.cases.length === 0).length
  const highRisk = scopedRows.filter((row) => ["HIGH", "CRITICAL"].includes(row.riskLevel.toUpperCase())).length

  useEffect(() => {
    if (!activeOfficer) setSelectedOfficer("")
    else if (!officerRows.some((officer) => officer.key === selectedOfficer)) setSelectedOfficer(activeOfficer.key)
  }, [selectedDistrict, scopedRows.length, officerRows.length])

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-[#d8dee8] bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-[#263747]">Staff Allocation Load</h3>
            <p className="mt-1 text-sm font-semibold text-[#64748b]">Drill from national scope to province, district, officer, and the exact cases allocated to that officer.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {isNationalUser && (
              <Field label="Province">
                <select className={inputClass} value={selectedProvince} onChange={(event) => { setSelectedProvince(event.target.value); setSelectedOfficer("") }}>
                  {provinceOptions.map((province) => <option key={province.id}>{province.name}</option>)}
                </select>
              </Field>
            )}
            {(isNationalUser || isProvincialHead) && (
              <Field label="District">
                <select className={inputClass} value={selectedDistrict} onChange={(event) => { setSelectedDistrict(event.target.value); setSelectedOfficer("") }}>
                  {provinceDistricts.map((district) => <option key={district.id}>{district.name}</option>)}
                </select>
              </Field>
            )}
            {isDistrictHead && <div className="rounded-md bg-[#f8fafc] px-4 py-3 text-sm font-bold text-[#263747]">{user.profile.districtName || "District scope"}</div>}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <RegionStat label="Allocated cases" value={totalAllocated} />
          <RegionStat label="Case officers" value={officerRows.length} />
          <RegionStat label="High / Critical" value={highRisk} />
          <RegionStat label="Officers with no cases" value={idle} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="overflow-hidden rounded-md border border-[#d8dee8] bg-white shadow-sm">
          <div className="border-b border-[#edf0f4] bg-[#f8fafc] px-4 py-3">
            <h3 className="text-base font-bold text-[#263747]">{selectedDistrict || selectedProvince || "Selected scope"} Staff Allocations Load</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-white text-[#2e6fa3]">
                <tr>{["Name", "District", "Total Cases Allocated", "High / Critical", "Newest Allocation", "Load"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr>
              </thead>
              <tbody>
                {officerRows.length ? officerRows.map((officer) => {
                  const officerHighRisk = officer.cases.filter((row) => ["HIGH", "CRITICAL"].includes(row.riskLevel.toUpperCase())).length
                  const allocationDates = officer.cases.map((row) => allocatedDate(row)).filter(Boolean).sort()
                  const newest = allocationDates[allocationDates.length - 1] || "-"
                  const loadTone = officer.cases.length >= 20 ? "bg-[#fee4e2] text-[#b42318]" : officer.cases.length >= 10 ? "bg-[#fff4d6] text-[#a05b16]" : "bg-[#e7f6f3] text-[#007464]"
                  return (
                    <tr key={officer.key} className={`cursor-pointer ${activeOfficer?.key === officer.key ? "bg-[#e7f6f3]" : "odd:bg-white even:bg-[#f8fafc] hover:bg-[#eef9f6]"}`} onClick={() => setSelectedOfficer(officer.key)}>
                      <td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#30528c]">{officer.name}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{officer.district}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3 text-lg font-bold text-[#263747]">{officer.cases.length}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{officerHighRisk}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{newest === "-" ? newest : formatWorkflowDateTime(newest)}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3"><span className={`rounded-full px-3 py-1 text-xs font-bold ${loadTone}`}>{officer.cases.length >= 20 ? "Heavy" : officer.cases.length >= 10 ? "Moderate" : "Available"}</span></td>
                    </tr>
                  )
                }) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={6}>No officers or allocated cases found for this scope.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="overflow-hidden rounded-md border border-[#d8dee8] bg-white shadow-sm">
          <div className="border-b border-[#edf0f4] bg-[#f8fafc] px-4 py-3">
            <h3 className="text-base font-bold text-[#263747]">{activeOfficer?.name || "Officer"} Case Numbers</h3>
            <div className="text-sm font-semibold text-[#64748b]">{activeOfficer?.cases.length || 0} allocated cases</div>
          </div>
          <div className="max-h-[620px] overflow-auto">
            {activeOfficer?.cases.length ? activeOfficer.cases.map((row) => (
              <div key={row.id} className="border-b border-[#edf0f4] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-[#30528c]">{row.id}</div>
                    <div className="mt-1 text-sm font-semibold text-[#263747]">{row.childName}</div>
                    <div className="mt-1 text-xs text-[#64748b]">{row.concern} | {row.ward}</div>
                  </div>
                  <PriorityBadge risk={row.riskLevel} />
                </div>
                <div className="mt-2 text-xs font-semibold text-[#64748b]">Allocated: {formatWorkflowDateTime(allocatedDate(row))}</div>
              </div>
            )) : <div className="p-6 text-sm font-semibold text-[#64748b]">Select an officer with allocated cases to see the case numbers.</div>}
          </div>
        </aside>
      </div>
    </div>
  )
}

function CcwMonthlyCaseSummaryReport({ user, alerts, users, districts, provinces }: { user: ApiUser; alerts: AlertRecord[]; users: ApiUser[]; districts: DistrictOption[]; provinces: ProvinceOption[] }) {
  const currentMonth = new Date().toISOString().slice(0, 7)
  const isNationalUser = ["SYS_ADMIN", "DEPUTY_DIRECTOR", "DIRECTOR", "PROGRAMME_OFFICER"].includes(user.profile.role)
  const isProvincialHead = user.profile.role === "PROVINCIAL_HEAD"
  const isDistrictHead = user.profile.role === "DISTRICT_HEAD"
  const provinceOptions = provinces.length ? provinces : Array.from(new Map(districts.map((district) => [district.province, { id: district.province, name: district.provinceName }])).values())
  const defaultProvince = isProvincialHead ? user.profile.provinceName : isDistrictHead ? districts.find((district) => district.name === user.profile.districtName)?.provinceName || "" : provinceOptions[0]?.name || ""
  const [selectedProvince, setSelectedProvince] = useState(defaultProvince)
  const provinceDistricts = districts.filter((district) => !selectedProvince || district.provinceName === selectedProvince)
  const [selectedDistrict, setSelectedDistrict] = useState(isDistrictHead ? user.profile.districtName : provinceDistricts[0]?.name || "")
  const [selectedWard, setSelectedWard] = useState("All")
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [selectedCcw, setSelectedCcw] = useState("All")
  const scopedDistricts = isDistrictHead ? districts.filter((district) => district.name === user.profile.districtName) : provinceDistricts
  const scopedAlerts = alerts.filter((alert) => {
    const district = districts.find((item) => item.name === alert.district)
    if (isDistrictHead && user.profile.districtName && alert.district !== user.profile.districtName) return false
    if (isProvincialHead && user.profile.provinceName && district?.provinceName !== user.profile.provinceName) return false
    if (isNationalUser && selectedProvince && district?.provinceName !== selectedProvince) return false
    if (selectedDistrict && alert.district !== selectedDistrict) return false
    if (selectedWard !== "All" && alert.ward !== selectedWard) return false
    if (selectedMonth && !dateInputValue(alert.submittedAt).startsWith(selectedMonth)) return false
    return true
  })
  const ccwUsers = users.filter((item) => item.profile.role === "CCW" && (!selectedDistrict || item.profile.districtName === selectedDistrict))
  const alertCcwNames = Array.from(new Set(scopedAlerts.filter((alert) => alert.reporterType === "CCW" || alert.information_source_reporter_type === "CCW").map((alert) => submittedByLabel(alert)).filter(Boolean))).sort()
  const ccwOptions = ["All", ...ccwUsers.map((item) => [item.first_name, item.last_name].filter(Boolean).join(" ") || item.username), ...alertCcwNames].filter((item, index, list) => list.indexOf(item) === index)
  const wardOptions = ["All", ...Array.from(new Set(scopedAlerts.filter((alert) => !selectedDistrict || alert.district === selectedDistrict).map((alert) => alert.ward).filter(Boolean))).sort()]
  const rows = scopedAlerts
    .filter((alert) => selectedCcw === "All" || submittedByLabel(alert).includes(selectedCcw) || alert.reporter === selectedCcw)
    .map((alert) => ({
      child: alert.childName || "Not captured",
      sex: alert.sex || "Unknown",
      age: alert.date_of_birth || alert.age || "Not captured",
      needs: alert.concern || alert.caseCategory || "Not captured",
      hiv: "Unknown",
      disability: alert.disability || "Unknown",
      servicesReceived: alert.services_contacted || alert.immediate_action_taken || "Not captured",
      outstanding: alert.actionPlan || alert.description || "Not captured",
      servicesReferred: alert.services_contacted || "Not captured",
      organization: alert.information_source_type || alert.reporterType || "Not captured",
      outcomes: alert.status || alert.internalStatus || "Not captured",
      comments: alert.description || "Not captured",
      ccw: submittedByLabel(alert),
      district: alert.district,
      ward: alert.ward,
    }))

  useEffect(() => {
    if (isDistrictHead) return
    const nextDistricts = districts.filter((district) => !selectedProvince || district.provinceName === selectedProvince)
    if (!nextDistricts.some((district) => district.name === selectedDistrict)) {
      setSelectedDistrict(nextDistricts[0]?.name || "")
      setSelectedWard("All")
      setSelectedCcw("All")
    }
  }, [selectedProvince, districts.length])

  function printReport() {
    window.print()
  }

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-[#d8dee8] bg-white p-4 shadow-sm print:hidden">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-[#263747]">CCW Monthly Case Summary Sheet</h3>
            <p className="mt-1 text-sm font-semibold text-[#64748b]">Generate the monthly sheet from alerts raised by each CCW, with scope filters for district, province, and national reporting.</p>
          </div>
          <button className="h-10 rounded-md bg-[#263747] px-4 text-sm font-semibold text-white" onClick={printReport}>Print</button>
        </div>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {isNationalUser && <Field label="Province"><select className={inputClass} value={selectedProvince} onChange={(event) => { setSelectedProvince(event.target.value); setSelectedCcw("All") }}>{provinceOptions.map((province) => <option key={province.id}>{province.name}</option>)}</select></Field>}
          {(isNationalUser || isProvincialHead) && <Field label="District"><select className={inputClass} value={selectedDistrict} onChange={(event) => { setSelectedDistrict(event.target.value); setSelectedWard("All"); setSelectedCcw("All") }}>{scopedDistricts.map((district) => <option key={district.id}>{district.name}</option>)}</select></Field>}
          {isDistrictHead && <Field label="District"><input className={inputClass} value={user.profile.districtName || ""} readOnly /></Field>}
          <Field label="Ward"><select className={inputClass} value={selectedWard} onChange={(event) => setSelectedWard(event.target.value)}>{wardOptions.map((ward) => <option key={ward}>{ward}</option>)}</select></Field>
          <Field label="Reporting month"><input className={inputClass} type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} /></Field>
          <Field label="CCW"><select className={inputClass} value={selectedCcw} onChange={(event) => setSelectedCcw(event.target.value)}>{ccwOptions.map((ccw) => <option key={ccw}>{ccw}</option>)}</select></Field>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <RegionStat label="Rows" value={rows.length} />
          <RegionStat label="CCWs" value={Math.max(0, ccwOptions.length - 1)} />
          <RegionStat label="High risk alerts" value={scopedAlerts.filter((alert) => ["HIGH", "CRITICAL"].includes(alert.riskLevel.toUpperCase())).length} />
          <RegionStat label="Selected ward" value={selectedWard} />
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-[#d8dee8] bg-white shadow-sm print:shadow-none">
        <div className="border-b border-[#d8dee8] px-5 py-4 text-center">
          <div className="text-xs text-right text-[#64748b]">V1.0</div>
          <h3 className="text-lg font-bold text-black">CCW Monthly Case summary Sheet</h3>
          <div className="mt-8 flex flex-wrap justify-center gap-x-8 gap-y-2 text-left text-sm font-bold text-black">
            <span>Name of CCW {selectedCcw === "All" ? "All CCWs" : selectedCcw}</span>
            <span>Reporting Month {selectedMonth || "Not selected"}</span>
            <span>District {selectedDistrict || "All"}</span>
            <span>Ward {selectedWard}</span>
          </div>
        </div>
        <div className="overflow-x-auto p-4">
          <table className="w-full min-w-[1180px] border-collapse text-left text-sm text-black">
            <thead>
              <tr>
                {["Name and surname of Child", "Sex of child", "Date of birth/Age", "Assessed Needs", "HIV Status 1 Positive 2 Negative 3 Unknown", "Disability Yes/No", "Services Received so far", "Outstanding Services required", "Services referred for", "Which organization was the child referred to?", "Outcomes of the referrals", "Comments on the case"].map((head) => (
                  <th key={head} className="border border-black px-2 py-2 align-top font-bold">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows.length ? rows : Array.from({ length: 3 }, () => null)).map((row, index) => (
                <tr key={index} className="min-h-[96px]">
                  {row ? [row.child, row.sex, row.age, row.needs, row.hiv, row.disability, row.servicesReceived, row.outstanding, row.servicesReferred, row.organization, row.outcomes, row.comments].map((value, cellIndex) => (
                    <td key={cellIndex} className="h-24 border border-black px-2 py-2 align-top">{value}</td>
                  )) : Array.from({ length: 12 }, (_, cellIndex) => <td key={cellIndex} className="h-24 border border-black px-2 py-2" />)}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-10 flex flex-wrap gap-x-8 gap-y-4 text-sm text-black">
            <span>Child Welfare Officer __________________________</span>
            <span>Signature __________________________</span>
            <span>Date __________________________</span>
          </div>
        </div>
      </section>
    </div>
  )
}

function chartNames(rows: ReportChartRow[], key: "name" | "month" = "name") {
  return rows.map((row) => row[key] || "Not captured")
}

function barOption(rows: ReportChartRow[]) {
  return {
    tooltip: { trigger: "axis" },
    grid: { left: 42, right: 20, top: 24, bottom: 72 },
    xAxis: { type: "category", data: chartNames(rows), axisLabel: { rotate: 35 } },
    yAxis: { type: "value" },
    series: [{ type: "bar", data: rows.map((row) => row.value), itemStyle: { color: "#008c7a" } }],
  }
}

function lineOption(rows: ReportChartRow[], key: "name" | "month" = "name") {
  return {
    tooltip: { trigger: "axis" },
    grid: { left: 42, right: 20, top: 24, bottom: 44 },
    xAxis: { type: "category", data: chartNames(rows, key) },
    yAxis: { type: "value" },
    series: [{ type: "line", smooth: true, data: rows.map((row) => row.value), areaStyle: {}, itemStyle: { color: "#2e6fa3" } }],
  }
}

function pieOption(rows: ReportChartRow[]) {
  return {
    tooltip: { trigger: "item" },
    legend: { bottom: 0, type: "scroll" },
    series: [{ type: "pie", radius: ["42%", "70%"], data: rows.map((row) => ({ name: row.name || "Not captured", value: row.value })) }],
  }
}

function funnelOption(rows: ReportChartRow[]) {
  return {
    tooltip: { trigger: "item" },
    series: [{ type: "funnel", left: "10%", width: "80%", minSize: "20%", data: rows.map((row) => ({ name: row.name || "Stage", value: row.value })) }],
  }
}

function ReportChart({ title, option }: { title: string; option: object }) {
  return (
    <section className="rounded-md border border-[#d8dee8] bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-base font-bold text-[#263747]">{title}</h3>
      <ReactECharts option={option} style={{ height: 340, width: "100%" }} notMerge />
    </section>
  )
}

function ReportTable({ title, rows }: { title: string; rows: Array<Record<string, string | number>> }) {
  const headers = rows[0] ? Object.keys(rows[0]) : []
  return (
    <section className="overflow-hidden rounded-md border border-[#d8dee8] bg-white shadow-sm">
      <div className="border-b border-[#edf0f4] px-4 py-3">
        <h3 className="text-base font-bold text-[#263747]">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{headers.map((header) => <th key={header} className="border-b border-[#d8dee8] px-3 py-3">{header}</th>)}</tr></thead>
          <tbody>
            {rows.length ? rows.map((row, index) => <tr key={index}>{headers.map((header) => <td key={header} className="border-b border-[#edf0f4] px-3 py-3">{row[header]}</td>)}</tr>) : <tr><td className="px-4 py-8 text-center text-[#64748b]">No report data available.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Panel({ title, icon: Icon, action, children }: { title: string; icon: ElementType; action?: ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-md bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#dfe4eb] pb-3">
        <div className="flex items-center gap-3"><Icon className="h-5 w-5 text-[#008c7a]" /><h2 className="text-[18px] font-bold text-[#263747]">{title}</h2></div>
        {typeof action === "string" ? <span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-semibold text-[#475569]">{action}</span> : action}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children, required: requiredOverride }: { label: string; children: React.ReactNode; required?: boolean }) {
  const requiredLabels = new Set([
    "District",
    "Ward",
    "Date reported",
    "Intake source",
    "Surname",
    "First names",
    "Sex",
    "Age",
    "Child current location",
    "Primary case category",
    "Concern description",
    "Risk level",
    "Immediate action plan",
    "Action plan",
    "Guardian type",
    "Telephone",
    "Address",
  ])
  const required = requiredOverride ?? requiredLabels.has(label)
  return (
    <label className="grid gap-2 text-sm font-semibold text-[#263747]">
      <span>{label}{required && <span className="ml-1 text-[#e11d48]">*</span>}</span>
      {children}
    </label>
  )
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return <Field label={label}><input className={`${inputClass} bg-[#f8fafc]`} value={value} readOnly /></Field>
}

function ReadonlyArea({ label, value }: { label: string; value: string }) {
  return <Field label={label}><textarea className={`${inputClass} min-h-[92px] bg-[#f8fafc] py-3`} value={value || "Not captured"} readOnly /></Field>
}

function AlertDossierCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-[#d8dee8] bg-white p-5 shadow-sm">
      <h4 className="mb-4 text-lg font-bold text-[#10233f]">{title}</h4>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function DossierGrid({ fields }: { fields: Array<[string, string | undefined]> }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {fields.map(([label, value]) => <Info key={label} label={label} value={value || "Not captured"} />)}
    </div>
  )
}

function DossierText({ title, value }: { title: string; value?: string }) {
  return (
    <div className="rounded-md border border-[#edf0f4] bg-[#f8fafc] p-4">
      <div className="mb-2 text-xs font-bold uppercase text-[#64748b]">{title}</div>
      <p className="whitespace-pre-wrap text-sm font-semibold leading-6 text-[#263747]">{value || "Not captured"}</p>
    </div>
  )
}

function DossierChips({ title, items, tone, empty = "Not captured" }: { title: string; items: string[]; tone: "blue" | "red"; empty?: string }) {
  const styles = tone === "red" ? "bg-[#fee4e2] text-[#b42318]" : "bg-[#e7f0fb] text-[#2e6fa3]"
  return (
    <div className="rounded-md border border-[#edf0f4] bg-[#f8fafc] p-4">
      <div className="mb-2 text-xs font-bold uppercase text-[#64748b]">{title}</div>
      <div className="flex flex-wrap gap-2">
        {items.length ? items.map((item) => <span key={item} className={`rounded-full px-3 py-1 text-xs font-bold ${styles}`}>{item}</span>) : <span className="text-sm font-semibold text-[#64748b]">{empty}</span>}
      </div>
    </div>
  )
}

function DossierAttachments({ attachments, fallback }: { attachments: Array<{ name: string; type?: string; url?: string }>; fallback?: string }) {
  const hasFallback = Boolean(fallback && fallback !== "No attachment captured")
  return (
    <div className="rounded-md border border-[#edf0f4] bg-[#f8fafc] p-4">
      {attachments.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {attachments.map((file, index) => (
            <div key={`${file.name}-${index}`} className="rounded-md border border-[#d8dee8] bg-white p-3">
              <div className="font-bold text-[#263747]">{file.name}</div>
              <div className="mt-1 text-sm font-semibold text-[#64748b]">{file.type || "Attachment"}</div>
            </div>
          ))}
        </div>
      ) : <div className="text-sm font-semibold text-[#64748b]">{hasFallback ? fallback : "No attachment captured."}</div>}
    </div>
  )
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-2">{children}</div>
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-[#f8fafc] p-3"><div className="text-xs font-bold uppercase text-[#64748b]">{label}</div><div className="mt-1 text-sm font-semibold text-[#263747]">{value}</div></div>
}

function StatusBadge({ status }: { status: string }) {
  const urgent = status.includes("Emergency") || status.includes("Immediate")
  const rejected = status.includes("Rejected") || status.includes("Closed")
  const converted = status.includes("Converted") || status.includes("Intake")
  const style = urgent ? "bg-[#fee4e2] text-[#b42318]" : rejected ? "bg-[#f1f5f9] text-[#475569]" : converted ? "bg-[#e7f0fb] text-[#2e6fa3]" : "bg-[#e7f6f3] text-[#007464]"
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${style}`}>{status}</span>
}

function CaseStatusBadge({ status }: { status: CaseRecord["status"] }) {
  const styles: Record<CaseRecord["status"], string> = {
    Draft: "bg-[#fff4d6] text-[#8a5b00]",
    Submitted: "bg-[#dbeafe] text-[#1d4ed8]",
    "Pending Supervisor Review": "bg-[#eee7f6] text-[#6b3fa0]",
    "Approved for Allocation": "bg-[#fff4d6] text-[#a05b16]",
    Allocated: "bg-[#e7f6f3] text-[#007464]",
  }
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${styles[status]}`}>{status}</span>
}

function SlaBadge({ sla }: { sla: ReturnType<typeof calculateSla> }) {
  const styles: Record<string, string> = {
    "ON TIME": "bg-[#e7f6f3] text-[#007464]",
    "SUBMITTED ON TIME": "bg-[#e7f6f3] text-[#007464]",
    "SUBMITTED LATE": "bg-[#fee4e2] text-[#b42318]",
    "DUE SOON": "bg-[#fff4d6] text-[#a05b16]",
    OVERDUE: "bg-[#fee4e2] text-[#b42318]",
    BREACHED: "bg-[#fee4e2] text-[#b42318]",
    PENDING: "bg-[#f1f5f9] text-[#64748b]",
  }
  return (
    <div className="flex min-w-[170px] items-center gap-2">
      <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-bold ${styles[sla.status] || styles.PENDING}`}>{sla.status}</span>
      <span className="whitespace-nowrap text-xs font-semibold text-[#64748b]">{sla.label}</span>
    </div>
  )
}

function PriorityBadge({ risk }: { risk: string }) {
  const upper = risk.toUpperCase()
  const style = upper === "CRITICAL" ? "bg-[#fee4e2] text-[#b42318]" : upper === "HIGH" ? "bg-[#fff1f2] text-[#be123c]" : upper === "MEDIUM" ? "bg-[#fff4d6] text-[#a05b16]" : "bg-[#e7f6f3] text-[#007464]"
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${style}`}>{upper}</span>
}

function MiniCard({ title, value, icon: Icon }: { title: string; value: string; icon: ElementType }) {
  return <article className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4"><Icon className="h-5 w-5 text-[#008c7a]" /><div className="mt-3 text-xs font-bold uppercase text-[#64748b]">{title}</div><div className="mt-1 font-semibold text-[#263747]">{value}</div></article>
}

function InfoRequests() {
  return <Panel title="Requests for More Information" icon={MessageSquareMore}><EmptyState text="No open requests. When DSDO requests more information, the reporter can add it here and the alert returns to Under Review." /></Panel>
}

function PublicNotifications({ alerts, onViewAlert }: { alerts: AlertRecord[]; onViewAlert: (alert: AlertRecord) => void }) {
  const orderedAlerts = [...alerts].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
  return (
    <Panel title="Notifications" icon={Bell} action={`${orderedAlerts.length} ${orderedAlerts.length === 1 ? "update" : "updates"}`}>
      {orderedAlerts.length ? (
        <div className="space-y-3">
          {orderedAlerts.map((alert) => <PublicNotificationCard key={alert.id} alert={alert} onViewAlert={onViewAlert} />)}
        </div>
      ) : <EmptyState text="No communication is available yet. Submitted alerts will appear here with their latest update." />}
    </Panel>
  )
}

function PublicNotificationCard({ alert, onViewAlert }: { alert: AlertRecord; onViewAlert: (alert: AlertRecord) => void }) {
  const feedback = publicAlertFeedback(alert)
  const statusStyle = publicNotificationStyle(alert)
  return (
    <article className={`rounded-md border bg-white p-4 shadow-sm ${statusStyle.border}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-bold text-[#10233f]">{alert.id}</div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusStyle.badge}`}>{publicNotificationLabel(alert)}</span>
          </div>
          <p className="mt-3 max-w-4xl text-sm font-semibold leading-6 text-[#52657f]">{feedback}</p>
        </div>
        <button className="inline-flex h-10 items-center gap-2 rounded-md border border-[#d8dee8] bg-white px-4 text-sm font-semibold text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]" onClick={() => onViewAlert(alert)}>
          <Eye className="h-4 w-4" /> View Submission
        </button>
      </div>
      <div className="mt-4 grid gap-2 rounded-md bg-[#f8fafc] p-3 text-sm text-[#475569] md:grid-cols-3">
        <div><span className="font-bold text-[#263747]">Submitted:</span> {alert.submittedAt || "Not captured"}</div>
        <div><span className="font-bold text-[#263747]">Location:</span> {alert.district || "Not captured"}{alert.ward ? ` | ${alert.ward}` : ""}</div>
        <div><span className="font-bold text-[#263747]">Child:</span> {alert.childName || "Not captured"}</div>
      </div>
    </article>
  )
}

function publicNotificationLabel(alert: AlertRecord) {
  if (alert.status === "More Information Requested") return "Action needed"
  if (alert.status === "Converted to Case" || alert.status === "Intake In Progress") return "Case opened"
  if (alert.status === "Emergency Response Initiated" || alert.emergency) return "Emergency response"
  if (alert.status === "Rejected" || alert.internalStatus === "Alert Rejected") return "Reviewed"
  if (alert.status === "Closed - No Further Action") return "Closed"
  return "Submitted"
}

function publicNotificationStyle(alert: AlertRecord) {
  if (alert.status === "More Information Requested") return { border: "border-[#f8c56d]", badge: "bg-[#fff4d6] text-[#a05b16]" }
  if (alert.status === "Emergency Response Initiated" || alert.emergency) return { border: "border-[#f4b4ac]", badge: "bg-[#fee4e2] text-[#b42318]" }
  if (alert.status === "Converted to Case" || alert.status === "Intake In Progress") return { border: "border-[#9ed8cc]", badge: "bg-[#e7f6f3] text-[#007464]" }
  if (alert.status === "Closed - No Further Action" || alert.status === "Rejected") return { border: "border-[#d8dee8]", badge: "bg-[#f1f5f9] text-[#64748b]" }
  return { border: "border-[#c8d9ee]", badge: "bg-[#e7f0fb] text-[#2e6fa3]" }
}

function isActiveInternalNotification(alert: AlertRecord) {
  const completedStatuses = new Set([
    "Converted to Case",
    "Intake In Progress",
    "Pending Supervisor Review",
    "Approved for Allocation",
    "Allocated to Case Officer",
    "Allocated",
    "Rejected",
    "Closed - No Further Action",
    "Duplicate / Already Known",
    "Referred to Relevant Office",
    "Closed - Invalid",
    "Referred Externally",
    "Merged Duplicate",
  ])
  if (completedStatuses.has(alert.status) || completedStatuses.has(alert.internalStatus)) return false
  if (alert.status === "More Information Requested" || alert.internalStatus === "More Information Required") return true
  if (alert.status === "Emergency Response Initiated" || alert.internalStatus === "Immediate Action Required") return true
  return Boolean(alert.emergency && ["Submitted", "Received by District Office", "Under Review", "Alert Submitted"].includes(alert.status || alert.internalStatus))
}

function Notifications({ alerts, onViewAlert }: { alerts: AlertRecord[]; onViewAlert: (alert: AlertRecord) => void }) {
  const notices = alerts.filter(isActiveInternalNotification)
  return (
    <Panel title="Notifications" icon={Bell}>
      {notices.length ? (
        <div className="space-y-3">
          {notices.map((alert) => <NotificationCard key={alert.id} alert={alert} onViewAlert={onViewAlert} />)}
        </div>
      ) : <EmptyState text="No notifications are available yet." />}
    </Panel>
  )
}

function ProfilePanel() {
  return <Panel title="Profile" icon={UserCheck}><EmptyState text="Sign in to view your captured user profile." /></Panel>
}

function InternalProfile({ user }: { user: ApiUser }) {
  const name = `${user.first_name} ${user.last_name}`.trim() || user.username
  return (
    <Panel title="Profile" icon={UserCheck} action={user.profile.roleLabel}>
      <FormGrid>
        <ReadonlyField label="Name" value={name} />
        <ReadonlyField label="Username" value={user.username} />
        <ReadonlyField label="Email" value={user.email || "Not captured"} />
        <ReadonlyField label="Role" value={user.profile.roleLabel} />
        <ReadonlyField label="District" value={user.profile.districtName || "National"} />
        <ReadonlyField label="Organization" value={user.profile.organizationName || "NCMIS"} />
      </FormGrid>
    </Panel>
  )
}

function LegacyPlaceholder({ view }: { view: string }) {
  const labels: Record<string, string> = {
    partners: "Partner Management",
    services: "Services Management",
    places: "Places of Safety",
    events: "Case Events Management",
    system: "System",
    collaboration: "My Collaboration",
  }
  return (
    <Panel title={labels[view] || "Module"} icon={FileText}>
      <EmptyState text="This module is parked in the old ICMS sidebar layout for now." />
    </Panel>
  )
}

function Audit({ alerts }: { alerts: AlertRecord[] }) {
  return <Panel title="Audit Logs" icon={History}>{alerts.length ? alerts.map((alert) => <Notice key={alert.id} text={`${alert.id}: ${alert.internalStatus} at ${alert.submittedAt}`} />) : <EmptyState text="No audit activity is available yet." />}</Panel>
}

function Setup({
  users,
  organizations,
  provinces,
  districts,
  wards,
  refreshUsers,
}: {
  users: ApiUser[]
  organizations: OrganizationOption[]
  provinces: ProvinceOption[]
  districts: DistrictOption[]
  wards: WardOption[]
  refreshUsers: () => Promise<void>
}) {
  const emptyUserForm = {
    username: "",
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    phone: "",
    role: "CCW",
    organization: "",
    province: "",
    district: "",
    ward: "",
    active: true,
  }
  type UserForm = typeof emptyUserForm
  const roleOptions = [
    ["SYS_ADMIN", "Super user / System administrator - internal"],
    ["DEPUTY_DIRECTOR", "Deputy Director - internal"],
    ["DIRECTOR", "Director - internal"],
    ["PROGRAMME_OFFICER", "Programme Officer - internal"],
    ["PROVINCIAL_HEAD", "Provincial Head - internal"],
    ["DISTRICT_HEAD", "District Head - internal"],
    ["DSDO", "DSDO - internal"],
    ["CCW", "CCW - public portal"],
    ["NGO", "NGO - public portal"],
    ["POLICE", "Police - public portal"],
    ["TEACHER", "Teacher - public portal"],
    ["NURSE", "Nurse - public portal"],
  ] as const
  const [form, setForm] = useState<UserForm>(emptyUserForm)
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null)
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null)
  const [tableUsers, setTableUsers] = useState<ApiUser[]>(users)
  const [roleFilter, setRoleFilter] = useState("")
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [message, setMessage] = useState("")
  const [successDialog, setSuccessDialog] = useState<{ title: string; detail: string } | null>(null)
  const [error, setError] = useState("")
  const districtId = Number(form.district) || null
  const provinceId = Number(form.province) || null
  const nationalRoles = ["SYS_ADMIN", "DEPUTY_DIRECTOR", "DIRECTOR", "PROGRAMME_OFFICER"]
  const provinceOnlyRoles = ["PROVINCIAL_HEAD"]
  const geographyDisabled = nationalRoles.includes(form.role)
  const districtDisabled = geographyDisabled || provinceOnlyRoles.includes(form.role)
  const wardDisabled = districtDisabled || !districtId
  const filteredDistricts = provinceId ? districts.filter((item) => item.province === provinceId) : districts
  const filteredWards = districtId ? wards.filter((item) => item.district === districtId) : []
  const filteredOrganizations = districtId ? organizations.filter((item) => !item.district || item.district === districtId) : organizations
  const visibleUsers = roleFilter ? tableUsers.filter((item) => item.profile.role === roleFilter) : tableUsers
  const pageCount = Math.max(1, Math.ceil(visibleUsers.length / rowsPerPage))
  const safePage = Math.min(page, pageCount)
  const pageStart = visibleUsers.length ? (safePage - 1) * rowsPerPage + 1 : 0
  const pageEnd = Math.min(safePage * rowsPerPage, visibleUsers.length)
  const pagedUsers = visibleUsers.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage)

  function setValue(key: keyof UserForm, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function setRole(value: string) {
    setForm((current) => ({
      ...current,
      role: value,
      province: nationalRoles.includes(value) ? "" : current.province,
      district: nationalRoles.includes(value) || provinceOnlyRoles.includes(value) ? "" : current.district,
      ward: nationalRoles.includes(value) || provinceOnlyRoles.includes(value) ? "" : current.ward,
    }))
  }

  function openCreateModal() {
    setForm(emptyUserForm)
    setEditingUser(null)
    setModalMode("create")
    setError("")
    setMessage("")
    setSuccessDialog(null)
  }

  function openEditModal(item: ApiUser) {
    setForm({
      username: item.username,
      first_name: item.first_name || "",
      last_name: item.last_name || "",
      email: item.email || "",
      password: "",
      phone: item.profile.phone || "",
      role: item.profile.role,
      organization: item.profile.organization ? String(item.profile.organization) : "",
      province: item.profile.province ? String(item.profile.province) : item.profile.district ? String(districts.find((district) => district.id === item.profile.district)?.province || "") : "",
      district: item.profile.district ? String(item.profile.district) : "",
      ward: item.profile.ward ? String(item.profile.ward) : "",
      active: item.profile.active,
    })
    setEditingUser(item)
    setModalMode("edit")
    setError("")
    setMessage("")
  }

  function closeModal() {
    setModalMode(null)
    setEditingUser(null)
    setError("")
  }

  async function saveUser() {
    setError("")
    setMessage("")
    const payload = {
      username: form.username.trim(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      ...(form.password ? { password: form.password } : {}),
      is_active: form.active,
      profile: {
        role: form.role,
        phone: form.phone.trim(),
        organization: form.organization ? Number(form.organization) : null,
        province: form.province ? Number(form.province) : null,
        district: form.district ? Number(form.district) : null,
        ward: form.ward ? Number(form.ward) : null,
        active: form.active,
      },
    }
    try {
      const wasEditing = modalMode === "edit" && editingUser
      const savedUser = wasEditing
        ? await apiPatch<ApiUser>(`/users/${editingUser.id}/`, payload)
        : await apiPost<ApiUser>("/users/", payload)
      setTableUsers((current) => {
        const exists = current.some((item) => item.id === savedUser.id)
        return exists ? current.map((item) => (item.id === savedUser.id ? savedUser : item)) : [...current, savedUser]
      })
      await refreshUsers()
      setRoleFilter("")
      setPage(1)
      const selectedRole = roleOptions.find(([value]) => value === form.role)?.[1].replace(" - internal", "").replace(" - public portal", "") || form.role
      setSuccessDialog({
        title: wasEditing ? "User updated" : "New user created",
        detail: wasEditing
          ? `${form.username} has been successfully updated as ${selectedRole}.`
          : `New user ${form.username} with position ${selectedRole} has been successfully created.`,
      })
      closeModal()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save user.")
    }
  }

  useEffect(() => {
    setPage(1)
  }, [roleFilter, rowsPerPage])

  useEffect(() => {
    setTableUsers(users)
  }, [users])

  return (
    <Panel title="User Management" icon={Users}>
      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <MiniCard title="Roles" value="National, Provincial Head, District Head, DSDO, CCW, NGO, Police, Teacher, Nurse" icon={Shield} />
        <MiniCard title="Geography" value={`${districts.length} districts, ${wards.length} wards`} icon={MapPin} />
        <MiniCard title="Users" value={`${visibleUsers.length} visible users`} icon={BriefcaseBusiness} />
      </div>
      {message && <Notice text={message} />}
      <div className="overflow-hidden rounded-md border border-[#d8dee8] bg-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d8dee8] bg-[#f8fafc] px-4 py-4">
          <div className="grid min-w-[250px] gap-2 text-sm font-semibold text-[#263747]">
            <span>Filter by role</span>
            <select className={inputClass} value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="">All roles</option>
              {roleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-white px-3 py-2 text-sm font-semibold text-[#475569] ring-1 ring-[#d8dee8]">{visibleUsers.length} users</span>
            <button className="inline-flex h-11 items-center gap-2 rounded-md bg-[#008c7a] px-4 font-semibold text-white shadow-sm hover:bg-[#007767]" onClick={openCreateModal}>
              <Plus className="h-4 w-4" /> New User
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
        <table className="min-w-[1320px] w-full text-left text-sm">
          <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Username", "First name", "Surname", "Email", "Role", "Portal", "Organization", "Province", "District", "Ward", "Status", "Actions"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
          <tbody>
            {pagedUsers.length ? pagedUsers.map((item) => (
              <tr key={item.id} className="border-b border-[#edf0f4]">
                <td className="px-3 py-3 font-semibold text-[#263747]">{item.username}</td>
                <td className="px-3 py-3">{item.first_name || "Not captured"}</td>
                <td className="px-3 py-3">{item.last_name || "Not captured"}</td>
                <td className="px-3 py-3">{item.email || "No email captured"}</td>
                <td className="px-3 py-3">{item.profile.roleLabel}</td>
                <td className="px-3 py-3 capitalize">{item.profile.portal}</td>
                <td className="px-3 py-3">{item.profile.organizationName || "Not assigned"}</td>
                <td className="px-3 py-3">{item.profile.provinceName || districts.find((district) => district.id === item.profile.district)?.provinceName || "All provinces"}</td>
                <td className="px-3 py-3">{item.profile.districtName || "All districts"}</td>
                <td className="px-3 py-3">{item.profile.wardName || "All wards"}</td>
                <td className="px-3 py-3"><StatusBadge status={item.profile.active ? "Active" : "Inactive"} /></td>
                <td className="px-3 py-3">
                  <button className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#2e6fa3] hover:border-[#008c7a] hover:text-[#008c7a]" title={`Edit ${item.username}`} onClick={() => openEditModal(item)}>
                    <PencilLine className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            )) : <tr><td className="px-3 py-8 text-center text-[#64748b]" colSpan={12}>No users match the selected role.</td></tr>}
          </tbody>
        </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d8dee8] bg-[#f8fafc] px-3 py-3 text-sm text-[#475569]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-[#263747]">Rows {pageStart}-{pageEnd} of {visibleUsers.length}</span>
            <label className="flex items-center gap-2 font-semibold">
              Show
              <select className="h-9 rounded-md border border-[#d8dee8] bg-white px-2 text-[#263747]" value={rowsPerPage} onChange={(event) => setRowsPerPage(Number(event.target.value))}>
                {[10, 25, 50].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 font-semibold text-[#263747] disabled:cursor-not-allowed disabled:opacity-45" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
            <span className="rounded-md bg-white px-3 py-2 font-semibold text-[#263747]">Page {safePage} of {pageCount}</span>
            <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 font-semibold text-[#263747] disabled:cursor-not-allowed disabled:opacity-45" disabled={safePage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</button>
          </div>
        </div>
      </div>
      {modalMode && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-md border border-[#d8dee8] bg-[#f8fafc] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold text-[#263747]">{modalMode === "edit" ? "Edit user and assigned role" : "Create user and assign role"}</h3>
              <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={closeModal}>Close</button>
            </div>
            {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
            <FormGrid>
              <Field label="Username"><input className={inputClass} value={form.username} onChange={(event) => setValue("username", event.target.value)} autoComplete="off" /></Field>
              <Field label="Temporary password"><input className={inputClass} type="password" value={form.password} onChange={(event) => setValue("password", event.target.value)} autoComplete="new-password" placeholder={modalMode === "edit" ? "Leave blank to keep current password" : ""} /></Field>
              <Field label="First names"><input className={inputClass} value={form.first_name} onChange={(event) => setValue("first_name", event.target.value)} /></Field>
              <Field label="Surname"><input className={inputClass} value={form.last_name} onChange={(event) => setValue("last_name", event.target.value)} /></Field>
              <Field label="Email"><input className={inputClass} type="email" value={form.email} onChange={(event) => setValue("email", event.target.value)} /></Field>
              <Field label="Telephone"><input className={inputClass} value={form.phone} onChange={(event) => setValue("phone", event.target.value)} /></Field>
              <Field label="Role">
                <select className={inputClass} value={form.role} onChange={(event) => setRole(event.target.value)}>
                  {roleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="Organization">
                <select className={inputClass} value={form.organization} onChange={(event) => setValue("organization", event.target.value)}>
                  <option value="">No organization selected</option>
                  {filteredOrganizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <Field label="Province">
                <select className={`${inputClass} disabled:bg-[#eef2f5] disabled:text-[#8aa0bf]`} value={form.province} onChange={(event) => setForm((current) => ({ ...current, province: event.target.value, district: "", ward: "" }))} disabled={geographyDisabled}>
                  <option value="">All provinces</option>
                  {provinces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <Field label="District">
                <select className={`${inputClass} disabled:bg-[#eef2f5] disabled:text-[#8aa0bf]`} value={form.district} onChange={(event) => setForm((current) => ({ ...current, district: event.target.value, ward: "" }))} disabled={districtDisabled}>
                  <option value="">National / all districts</option>
                  {filteredDistricts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <Field label="Ward">
                <select className={`${inputClass} disabled:bg-[#eef2f5] disabled:text-[#8aa0bf]`} value={form.ward} onChange={(event) => setValue("ward", event.target.value)} disabled={wardDisabled}>
                  <option value="">No ward restriction</option>
                  {filteredWards.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <label className="flex items-center gap-3 rounded-md border border-[#d8dee8] bg-white px-3 py-3 text-sm font-semibold text-[#263747]">
                <input type="checkbox" className="h-5 w-5 accent-[#008c7a]" checked={form.active} onChange={(event) => setValue("active", event.target.checked)} />
                Active user
              </label>
            </FormGrid>
            <button className="mt-5 rounded-md bg-[#008c7a] px-5 py-3 font-semibold text-white hover:bg-[#007767]" onClick={saveUser}>{modalMode === "edit" ? "Save user" : "Create user"}</button>
          </div>
        </div>
      )}
      {successDialog && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="w-full max-w-md rounded-md border border-[#cfe4df] bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#e7f6f3] text-[#008c7a]">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-xl font-bold text-[#263747]">{successDialog.title}</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7191]">{successDialog.detail}</p>
            <button className="mt-6 h-11 rounded-md bg-[#008c7a] px-8 font-semibold text-white hover:bg-[#007767]" onClick={() => setSuccessDialog(null)}>OK</button>
          </div>
        </div>
      )}
    </Panel>
  )
}

function Notice({ text }: { text: string }) {
  return <div className="mb-3 flex items-center gap-3 rounded-md border border-[#d8dee8] bg-white p-3 text-sm"><CheckCircle2 className="h-4 w-4 text-[#008c7a]" />{text}</div>
}

function NotificationCard({ alert, onViewAlert }: { alert: AlertRecord; onViewAlert: (alert: AlertRecord) => void }) {
  const dangerItems = alert.danger.length ? alert.danger : ["No immediate danger factors captured"]
  const isEmergency = alert.emergency || alert.internalStatus === "Immediate Action Required"
  return (
    <article className={`rounded-md border bg-white p-4 shadow-sm ${isEmergency ? "border-[#f4b4ac]" : "border-[#d8dee8]"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-bold text-[#263747]">{alert.id}</div>
          <div className={`mt-1 inline-flex rounded-full px-3 py-1 text-xs font-bold ${isEmergency ? "bg-[#fee4e2] text-[#b42318]" : "bg-[#e7f0fb] text-[#2e6fa3]"}`}>
            {isEmergency ? "Immediate Action Required" : alert.internalStatus || alert.status}
          </div>
        </div>
        <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white hover:bg-[#007767]" onClick={() => onViewAlert(alert)}>
          <Eye className="h-4 w-4" /> View Alert
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {dangerItems.map((item) => <span key={item} className={`rounded-full px-3 py-1 text-xs font-bold ${alert.danger.length ? "bg-[#fee4e2] text-[#b42318]" : "bg-[#f1f5f9] text-[#64748b]"}`}>{item}</span>)}
      </div>
      <div className="mt-3 grid gap-2 text-sm text-[#475569] md:grid-cols-2">
        <div><span className="font-bold text-[#263747]">District:</span> {alert.district || "Not captured"}{alert.ward ? ` | ${alert.ward}` : ""}</div>
        <div><span className="font-bold text-[#263747]">Submitted by:</span> {submittedByLabel(alert)}</div>
        <div><span className="font-bold text-[#263747]">Child:</span> {alert.childName || "Not captured"}</div>
        <div><span className="font-bold text-[#263747]">Concern:</span> {alertConcerns(alert).join(", ") || "Not captured"}</div>
      </div>
    </article>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return <div className="rounded-md border border-[#fecaca] bg-[#fef2f2] p-3 text-sm font-semibold text-[#b42318]">{message}</div>
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-8 text-center text-sm text-[#64748b]">{text}</div>
}
