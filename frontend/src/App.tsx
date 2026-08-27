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
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Download,
  Eye,
  File,
  FileSearch,
  FileText,
  Filter,
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
  MoreVertical,
  PencilLine,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Settings,
  Send,
  Shield,
  ShieldAlert,
  Trash2,
  UserCheck,
  Users,
  X,
} from "lucide-react"
import ReactECharts from "echarts-for-react"
import { toPng } from "html-to-image"
import type { ElementType, ReactNode } from "react"
import { Fragment, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { geoJSON } from "leaflet"
import type { LatLngBoundsExpression } from "leaflet"
import { CircleMarker, GeoJSON as LeafletGeoJSON, LayerGroup, LayersControl, MapContainer, Popup, TileLayer, Tooltip, useMap } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import { apiBlob, apiChangePassword, apiDelete, apiGet, apiLogin, apiLogout, apiPatch, apiPost, currentUser } from "./services/api"
import type { PasswordChangeRequired } from "./services/api"
import coatOfArms from "./assets/cot.svg"
import zimbabwePreviewGeoJson from "./assets/geo/zimbabwe-preview.json"

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
  validity_decision?: "VALID" | "INVALID" | ""
  invalid_reason?: string
  home_address?: string
  district: string
  ward: string
  village_suburb?: string
  chief_name?: string
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
  incident_date?: string
  date_reporter_became_aware?: string
  incident_location?: string
  alleged_perpetrator_name?: string
  alleged_perpetrator_relationship?: string
  alleged_perpetrator_known?: string
  alleged_perpetrator_sex?: string
  alleged_perpetrator_race?: string
  perpetrator_has_access?: string
  referred_to_police?: string
  police_referral_date?: string | null
  court_appearance_scheduled?: string
  court_appearance_date?: string | null
  conviction_determined?: string
  conviction_date?: string | null
  status: AlertStatus
  internalStatus: string
  emergency: boolean
  is_emergency?: boolean
  is_immediate_danger?: boolean
  priority_level?: string
  emergency_classification?: EmergencyClassification
  safeguarding_classification?: string
  classification_trigger_codes?: string[]
  immediate_action_plan?: string
  immediate_action_at?: string | null
  immediate_action_responsible?: string
  immediate_action_status?: string
  supervisor_notified?: string
  supervisor_notification_at?: string | null
  supervisor_notified_no_reason?: string
  child_moved_to_safety?: string
  referral_authority_contacted?: string
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



type EmergencyClassification = "NON_EMERGENCY" | "EMERGENCY" | "EMERGENCY_IMMEDIATE_DANGER"
type EmergencyPriority = "Normal" | "Emergency" | "Critical"
type SafeguardingClassification = "NORMAL" | "EMERGENCY" | "IMMEDIATE_DANGER"

function yesNo(value: unknown) {
  const text = `${value ?? ""}`.trim().toLowerCase()
  if (["yes", "true", "1"].includes(text)) return "Yes"
  if (["no", "false", "0"].includes(text)) return "No"
  return ""
}

function classifyEmergency(emergencyValue: unknown, dangerValue: unknown): { isEmergency: boolean; isImmediateDanger: boolean; priorityLevel: EmergencyPriority; classification: EmergencyClassification; emergencyReported: "Yes" | "No"; immediateDangerReported: "Yes" | "No" } {
  const danger = yesNo(dangerValue) === "Yes"
  const emergency = yesNo(emergencyValue) === "Yes" || danger
  if (danger) return { isEmergency: true, isImmediateDanger: true, priorityLevel: "Critical", classification: "EMERGENCY_IMMEDIATE_DANGER", emergencyReported: "Yes", immediateDangerReported: "Yes" }
  if (emergency) return { isEmergency: true, isImmediateDanger: false, priorityLevel: "Emergency", classification: "EMERGENCY", emergencyReported: "Yes", immediateDangerReported: "No" }
  return { isEmergency: false, isImmediateDanger: false, priorityLevel: "Normal", classification: "NON_EMERGENCY", emergencyReported: "No", immediateDangerReported: "No" }
}

function emergencyBadgeLabel(record: { isImmediateDanger?: boolean; isEmergency?: boolean; emergency?: boolean; emergencyClassification?: string; emergency_classification?: string; riskLevel?: string }) {
  const classification = record.emergencyClassification || record.emergency_classification || ""
  if (record.isImmediateDanger || classification === "EMERGENCY_IMMEDIATE_DANGER") return "IMMEDIATE DANGER"
  if (record.isEmergency || record.emergency || classification === "EMERGENCY") return "EMERGENCY"
  return ""
}

function isEmergencyCaseRecord(record: CaseRecord) {
  return Boolean(record.isEmergency || record.emergencyClassification === "EMERGENCY" || record.emergencyClassification === "EMERGENCY_IMMEDIATE_DANGER")
}

function isImmediateDangerCaseRecord(record: CaseRecord) {
  return Boolean(record.isImmediateDanger || record.emergencyClassification === "EMERGENCY_IMMEDIATE_DANGER")
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
  captureLatitude?: number
  captureLongitude?: number
  concern: string
  riskLevel: string
  status: "Draft" | "Submitted" | "Pending Supervisor Review" | "Approved for Allocation" | "Allocated"
  intakeOfficer: string
  allocatedOfficerId?: number | null
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
  assessmentCarePlanSubmittedAt?: string | null
  caseReviewDueAt?: string | null
  caseReviewStatus?: string
  closureStatus?: string
  createdAt: string
  updatedAt?: string
  submittedForReviewAt?: string
  description: string
  background_information?: Record<string, unknown>
  previous_contacts?: PreviousContacts
  isEmergency?: boolean
  isImmediateDanger?: boolean
  priorityLevel?: string
  emergencyClassification?: EmergencyClassification
  manualMinimumComplete?: boolean
}

type SaveDraftCaseOptions = {
  openIntake?: boolean
}

type WorkflowNotification = {
  id: string | number
  title: string
  message: string
  category: "Allocation" | "Intake" | "Assessment" | "Care Plan" | "SLA" | "Alert"
  priority: "info" | "warning" | "critical" | "escalated"
  targetType: "alert" | "case"
  targetId: string
  actionLabel: string
  createdAt: string
  updatedAt?: string
  dueAt?: string
  resolvedAt?: string | null
  route: "triage" | "case-intake" | "review" | "allocation" | "allocated-cases" | "update-requests"
  unread?: boolean
}

type PreviousContactKey = "dcwps" | "law" | "court_orders" | "other_agencies"
type PreviousContact = { has_contact: "" | "Yes" | "No"; reason: string }
type PreviousContacts = Record<PreviousContactKey, PreviousContact>

const previousContactDefinitions: { key: PreviousContactKey; label: string; question: string; reasonLabel: string }[] = [
  { key: "dcwps", label: "DSW", question: "Previous contact with DSW?", reasonLabel: "Reason for contact with DSW" },
  { key: "law", label: "Law", question: "Any previous contact with the law?", reasonLabel: "Reason for contact with the law" },
  { key: "court_orders", label: "Court Orders", question: "Previous court orders?", reasonLabel: "Reason for court order / contact" },
  { key: "other_agencies", label: "Other Agencies", question: "Previous contact with other agencies?", reasonLabel: "Reason for contact with agencies" },
]

function emptyPreviousContacts(): PreviousContacts {
  return { dcwps: { has_contact: "", reason: "" }, law: { has_contact: "", reason: "" }, court_orders: { has_contact: "", reason: "" }, other_agencies: { has_contact: "", reason: "" } }
}

function normalizePreviousContacts(value: unknown): PreviousContacts {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const legacy = source.previous_contacts && typeof source.previous_contacts === "object" ? source.previous_contacts as Record<string, unknown> : source
  const contacts = emptyPreviousContacts()
  previousContactDefinitions.forEach(({ key }) => {
    const record = legacy[key] && typeof legacy[key] === "object" ? legacy[key] as Record<string, unknown> : {}
    contacts[key] = { has_contact: record.has_contact === "Yes" || record.has_contact === "No" ? record.has_contact : "", reason: typeof record.reason === "string" ? record.reason : "" }
  })
  return contacts
}

type IntakeRecord = {
  id: number
  alert: number | null
  alertReference?: string | null
  districtName?: string
  createdBy?: {
    id: number
    username: string
    firstName: string
    lastName: string
    displayName: string
    officerCode: string
    role: string
    roleLabel: string
    districtName: string
    phone: string
    email: string
  }
  temporary_case_reference: string
  intake_source?: string
  original_alert_snapshot?: Record<string, unknown>
  opening_summary?: Record<string, unknown>
  child_profile_draft?: Record<string, unknown>
  alleged_perpetrators?: AllegedPerpetratorDraft[]
  referral_date?: string | null
  case_referred_by?: string
  household_profile_draft?: Record<string, unknown>
  background_information?: Record<string, unknown>
  initial_screening_notes?: string
  screening_completed_at?: string | null
  case_category?: string
  risk_level?: string
  immediate_action_required?: boolean
  immediate_action_plan?: string
  is_emergency?: boolean
  is_immediate_danger?: boolean
  priority_level?: string
  emergency_classification?: EmergencyClassification
  safeguarding_classification?: string
  classification_trigger_codes?: string[]
  immediate_action_at?: string | null
  immediate_action_responsible?: string
  immediate_action_status?: string
  supervisor_notified?: string
  supervisor_notification_at?: string | null
  supervisor_notified_no_reason?: string
  child_moved_to_safety?: string
  referral_authority_contacted?: string
  emergency_change_reason?: string
  supervisor_notes?: string
  reviewedByName?: string
  reviewed_at?: string | null
  allocatedByName?: string
  allocated_at?: string | null
  allocationDelaySeconds?: number | null
  allocationDelayStatus?: string
  assessment_draft?: Record<string, unknown>
  care_plan_draft?: Record<string, unknown>
  care_plan_versions_draft?: Record<string, unknown>[] | Record<string, unknown>
  care_plan_change_logs_draft?: Record<string, unknown>[] | Record<string, unknown>
  case_conferences_draft?: Record<string, unknown>[] | Record<string, unknown>
  justice_draft?: Record<string, unknown>
  referrals_draft?: Record<string, unknown>[] | Record<string, unknown>
  service_tracking_draft?: Record<string, unknown>[] | Record<string, unknown>
  case_notes_draft?: Record<string, unknown>[] | Record<string, unknown>
  case_documents_draft?: Record<string, unknown>[] | Record<string, unknown>
  monitoring_followups_draft?: Record<string, unknown>[] | Record<string, unknown>
  case_reviews_draft?: Record<string, unknown>[] | Record<string, unknown>
  assessment_started_at?: string | null
  assessment_due_at?: string | null
  assessment_completed_at?: string | null
  assessmentCompletedByName?: string
  assessmentRemainingSeconds?: number | null
  assessmentSlaStatus?: string
  assessment_care_plan_status?: string
  assessment_care_plan_submitted_at?: string | null
  assessment_care_plan_reviewed_at?: string | null
  assessment_care_plan_review_notes?: string
  assessment_care_plan_review_history?: Array<Record<string, unknown>>
  case_review_due_at?: string | null
  caseReviewStatus?: string
  closure_status?: string
  closure_reviewed_at?: string | null
  closure_draft?: Record<string, unknown>
  closure_history_draft?: Record<string, unknown>[] | Record<string, unknown>
  status: string
  allocated_officer?: number | null
  allocatedOfficerName?: string
  created_at: string
  updated_at?: string
}

type IntakeUpdateField = {
  path: string
  label: string
  current_value: string
  proposed_value?: string
  tab_name?: string
  section_name?: string
  old_value?: string
  new_value?: string
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
  requestedByUsername: string
  requestedByRole: string
  requested_at: string
  reviewedByName: string
  reviewedByUsername: string
  reviewedByRole: string
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
  const parts = reference.split(/[-/]/).filter(Boolean)
  const year = parts.find((part) => /^\d{4}$/.test(part)) || new Date().getFullYear().toString()
  const sequence = [...parts].reverse().find((part) => /^\d+$/.test(part) && part !== year) || "001"
  return { year, sequence: sequence.padStart(4, "0") }
}

function formatCaseNumber(reference: string, districtCode = "") {
  if (/^[A-Z]{2,3}\/\d{4}\/\d{4,}$/.test(reference)) return reference
  const { year, sequence } = caseSequenceParts(reference)
  return `${districtCode || "PENDING"}/${year}/${sequence}`
}

function displayCaseId(intake: IntakeRecord, districts: DistrictOption[] = []) {
  if (/^[A-Z]{2,3}\/\d{4}\/\d{4,}$/.test(intake.temporary_case_reference)) return intake.temporary_case_reference
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

function hasManualStartedDraft(opening: Record<string, unknown>) {
  return hasText(opening.autosave_started_at) || hasText(opening.last_active_tab)
}

function hasManualOfficerInformantData(opening: Record<string, unknown>) {
  const informant = typeof opening.informant === "object" && opening.informant !== null ? opening.informant as Record<string, unknown> : {}
  return [
    informant.surname,
    informant.first_names,
    informant.phone,
    informant.relationship_to_child,
    informant.organization,
  ].some(hasText)
}

function hasManualChildData(childDraft: Record<string, unknown>) {
  const childKnown = textValue(childDraft.known)
  if (!childKnown) return false
  if (childKnown === "No") return hasText(childDraft.age)
  return [childDraft.first_names, childDraft.surname, childDraft.age].some(hasText)
}

const HOME_LANGUAGE_OPTIONS = ["English", "Shona", "Ndebele"]
const RELIGION_OPTIONS = ["Christian", "Jewish", "Muslim", "Other"]
const RACE_OPTIONS = ["Black", "White", "Coloured"]

function hasManualMinimumIntakeData(opening: Record<string, unknown>, childDraft: Record<string, unknown>) {
  return hasManualStartedDraft(opening) || hasManualOfficerInformantData(opening) || hasManualChildData(childDraft)
}

function dateInputValue(value: string) {
  const parsed = parseWorkflowDate(value)
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10)
}

function isoDateFromLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

function calculateAgeFromBirthDate(value: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ""
  const birthDate = new Date(`${value}T00:00:00`)
  if (Number.isNaN(birthDate.getTime()) || birthDate > now) return ""
  let age = now.getFullYear() - birthDate.getFullYear()
  const monthDelta = now.getMonth() - birthDate.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birthDate.getDate())) age -= 1
  return age >= 0 ? `${age}` : ""
}

function estimatedBirthMonthFromAge(ageValue: string, now = new Date()) {
  const age = Number.parseInt(ageValue, 10)
  if (!Number.isFinite(age) || age < 0) return ""
  return `${now.getFullYear() - age}-${`${now.getMonth() + 1}`.padStart(2, "0")}`
}

function estimatedBirthMonthRange(ageValue: string, now = new Date()) {
  const age = Number.parseInt(ageValue, 10)
  if (!Number.isFinite(age) || age < 0) return { min: "", max: "" }
  const minDate = new Date(now.getFullYear() - age - 1, now.getMonth(), now.getDate() + 1)
  const maxDate = new Date(now.getFullYear() - age, now.getMonth(), now.getDate())
  return { min: isoDateFromLocalDate(minDate).slice(0, 7), max: isoDateFromLocalDate(maxDate).slice(0, 7) }
}

function officerDefaults(user: ApiUser) {
  return {
    officer_user_id: user.profile.officerCode || `DSD${`${user.id}`.padStart(4, "0")}`,
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
  const intakeOfficer = [nestedTextValue(opening, "officer_first_names"), nestedTextValue(opening, "officer_surname")].filter(Boolean).join(" ") || intake.createdBy?.displayName || ""
  const childName = [textValue(childDraft.first_names), textValue(childDraft.surname)].filter(Boolean).join(" ")
  const capturedLocation = `${sourceAlert?.incident_location || snapshot.incident_location || ""}`.match(/GPS(?: coordinates)?:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i)
  return {
    id: displayCaseId(intake, districts),
    backendIntakeId: intake.id,
    sourceAlertId: intake.alertReference || undefined,
    intakeDraft: intake,
    childName: sourceAlert?.childName || childName || textValue(childDraft.name) || textValue(snapshot.child_name) || "Unknown child",
    sex: sourceAlert?.sex || textValue(childDraft.sex) || textValue(snapshot.sex) || "Unknown",
    age: sourceAlert?.age || textValue(childDraft.age) || textValue(snapshot.age) || "Unknown",
    district: sourceAlert?.district || intake.districtName || textValue(childDraft.district) || textValue(opening.district) || textValue(snapshot.district),
    ward: sourceAlert?.ward || textValue(childDraft.ward) || textValue(opening.ward) || textValue(snapshot.ward),
    captureLatitude: Number(childDraft.capture_latitude ?? childDraft.latitude ?? capturedLocation?.[1]) || undefined,
    captureLongitude: Number(childDraft.capture_longitude ?? childDraft.longitude ?? capturedLocation?.[2]) || undefined,
    concern: intake.case_category || sourceAlert?.concern || textValue(opening.concern_summary) || "Uncategorized",
    riskLevel: intake.risk_level || sourceAlert?.riskLevel || "Pending",
    status: caseStatusFromIntake(intake.status),
    intakeOfficer: sourceAlert?.intakeOfficer || intakeOfficer || "Intake Officer",
    allocatedOfficerId: intake.allocated_officer || null,
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
    assessmentCarePlanSubmittedAt: intake.assessment_care_plan_submitted_at || null,
    caseReviewDueAt: intake.case_review_due_at || null,
    caseReviewStatus: intake.caseReviewStatus,
    closureStatus: intake.closure_status,
    isEmergency: Boolean(intake.is_emergency),
    isImmediateDanger: Boolean(intake.is_immediate_danger),
    priorityLevel: intake.priority_level,
    emergencyClassification: intake.emergency_classification,
    createdAt: intake.created_at,
    submittedForReviewAt: textValue(intake.screening_completed_at) || textValue(screeningDraft.submitted_for_review_at),
    description: intake.immediate_action_plan || sourceAlert?.description || textValue(opening.reporter_narrative) || textValue(snapshot.description),
    background_information: intake.background_information || {},
    manualMinimumComplete: Boolean(intake.alertReference) || hasManualMinimumIntakeData(opening, childDraft),
  }
}

function userDisplayName(user: ApiUser) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username
}

function isAdminRole(role: string) {
  return role === "SYS_ADMIN"
}

function upsertById<T extends { id: string | number }>(items: T[], item: T, toTop = false) {
  const exists = items.some((current) => current.id === item.id)
  if (exists) return items.map((current) => (current.id === item.id ? item : current))
  return toTop ? [item, ...items] : [...items, item]
}

function mergeById<T extends { id: string | number }>(items: T[], preserved: T[], toTop = false) {
  return preserved.reduce((current, item) => upsertById(current, item, toTop), items)
}

function sameOfficer(caseRecord: CaseRecord, user: ApiUser) {
  const assigned = (caseRecord.allocatedOfficer || "").toLowerCase()
  const name = userDisplayName(user).toLowerCase()
  return Boolean(assigned && (assigned === name || assigned === user.username.toLowerCase() || assigned.includes(name)))
}

function notificationPriorityRank(priority: WorkflowNotification["priority"]) {
  return { escalated: 0, critical: 1, warning: 2, info: 3 }[priority]
}

function buildWorkflowNotifications(user: ApiUser, alerts: AlertRecord[], cases: CaseRecord[]) {
  const role = user.profile.role
  const isDistrictHead = role === "DISTRICT_HEAD"
  const userDistrict = user.profile.districtName || ""
  const now = Date.now()
  const inDistrictScope = (district: string) => Boolean(userDistrict && district === userDistrict)
  const notes: WorkflowNotification[] = []

  alerts.forEach((alert) => {
    if (!isDistrictHead || !inDistrictScope(alert.district)) return
    const status = alert.internalStatus || alert.status
    if (["Alert Submitted", "Received by District Office", "Under Review", "Submitted"].includes(status)) {
      notes.push({
        id: `alert-${alert.id}-intake-allocation`,
        title: "Submitted intake needs attention",
        message: `${alert.id} is waiting for district review or conversion.`,
        category: "Intake",
        priority: alert.emergency ? "critical" : "warning",
        targetType: "alert",
        targetId: alert.id,
        actionLabel: "Open alert",
        createdAt: alert.submittedAt,
        route: "triage",
        unread: true,
      })
    }
    if (alert.emergency && !["Converted to Case", "Closed - No Further Action", "Rejected", "Closed - Invalid"].includes(status)) {
      notes.push({
        id: `alert-${alert.id}-emergency`,
        title: "Emergency alert active",
        message: `${alert.childName || "Child"} has an emergency alert requiring visible action.`,
        category: "Alert",
        priority: "critical",
        targetType: "alert",
        targetId: alert.id,
        actionLabel: "Review emergency",
        createdAt: alert.submittedAt,
        route: "triage",
        unread: true,
      })
    }
  })

  cases.filter((caseRecord) => !isEmptyManualPlaceholder(caseRecord)).forEach((caseRecord) => {
    const assignedToUser = role === "DSDO" && sameOfficer(caseRecord, user)
    const districtHeadForCase = isDistrictHead && inDistrictScope(caseRecord.district)
    if (!assignedToUser && !districtHeadForCase) return
    const createdAt = caseRecord.allocatedAt || caseRecord.submittedForReviewAt || caseRecord.createdAt
    if (assignedToUser && caseRecord.status === "Allocated") {
      notes.push({
        id: `case-${caseRecord.id}-allocated`,
        title: "Case allocated to you",
        message: `${caseRecord.id} has been allocated to you for assessment and follow-up.`,
        category: "Allocation",
        priority: ["HIGH", "CRITICAL"].includes(caseRecord.riskLevel.toUpperCase()) ? "critical" : "info",
        targetType: "case",
        targetId: caseRecord.id,
        actionLabel: "Open case",
        createdAt,
        route: "case-intake",
        unread: true,
      })
    }
    if (districtHeadForCase && caseRecord.status === "Pending Supervisor Review") {
      notes.push({
        id: `case-${caseRecord.id}-screening-review`,
        title: "Case awaiting allocation",
        message: `${caseRecord.id} is waiting for district allocation.`,
        category: "Allocation",
        priority: "warning",
        targetType: "case",
        targetId: caseRecord.id,
        actionLabel: "Allocate case",
        createdAt: caseRecord.submittedForReviewAt || createdAt,
        route: "allocation",
        unread: true,
      })
    }
    if (districtHeadForCase && caseRecord.status === "Approved for Allocation") {
      notes.push({
        id: `case-${caseRecord.id}-allocation-ready`,
        title: "Case needs allocation",
        message: `${caseRecord.id} is approved and needs assignment to an SDO.`,
        category: "Allocation",
        priority: "warning",
        targetType: "case",
        targetId: caseRecord.id,
        actionLabel: "Allocate case",
        createdAt,
        route: "allocation",
        unread: true,
      })
    }
    if ((assignedToUser || districtHeadForCase) && caseRecord.assessmentDueAt && !caseRecord.assessmentCompletedAt) {
      const due = parseWorkflowDate(caseRecord.assessmentDueAt)
      const remainingMs = due.getTime() - now
      if (Number.isFinite(remainingMs) && remainingMs <= 48 * 60 * 60 * 1000) {
        notes.push({
          id: `case-${caseRecord.id}-assessment-due`,
          title: remainingMs < 0 ? "Assessment overdue" : "Assessment due soon",
          message: remainingMs < 0 ? `${caseRecord.id} assessment is overdue by ${formatDuration(Math.floor(Math.abs(remainingMs) / 1000))}.` : `${caseRecord.id} assessment is due ${relativeDueDateLabel(caseRecord.assessmentDueAt)}.`,
          category: "Assessment",
          priority: remainingMs < 0 ? (districtHeadForCase ? "escalated" : "critical") : "warning",
          targetType: "case",
          targetId: caseRecord.id,
          actionLabel: "Open assessment",
          createdAt,
          dueAt: caseRecord.assessmentDueAt,
          route: assignedToUser ? "case-intake" : "allocated-cases",
          unread: true,
        })
      }
    }
    if (districtHeadForCase && caseRecord.assessmentCarePlanStatus === "Submitted") {
      notes.push({
        id: `case-${caseRecord.id}-care-plan-review`,
        title: "Assessment and care plan submitted",
        message: `${caseRecord.id} is waiting for supervisor assessment and care plan review.`,
        category: "Care Plan",
        priority: "warning",
        targetType: "case",
        targetId: caseRecord.id,
        actionLabel: "Open submission",
        createdAt,
        route: "allocated-cases",
        unread: true,
      })
    }
  })

  const unique = new Map(notes.map((item) => [item.id, item]))
  return Array.from(unique.values()).sort((a, b) => {
    const priority = notificationPriorityRank(a.priority) - notificationPriorityRank(b.priority)
    if (priority !== 0) return priority
    return parseWorkflowDate(b.createdAt).getTime() - parseWorkflowDate(a.createdAt).getTime()
  })
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
  status?: string
  createdByName?: string
  updatedByName?: string
  created_at?: string
  updated_at?: string
}

type WardOption = {
  id: number
  name: string
  province?: number | null
  provinceName?: string
  district: number
  districtName: string
  description?: string
  status?: string
  createdByName?: string
  updatedByName?: string
  created_at?: string
  updated_at?: string
}

type ProvinceOption = {
  id: number
  name: string
  code?: string
  status?: string
  createdByName?: string
  updatedByName?: string
  created_at?: string
  updated_at?: string
}

type SetupRecord = {
  id: number
  province?: number | null
  provinceName?: string
  district?: number | null
  districtName?: string
  ward?: number | null
  wardName?: string
  name?: string
  code?: string
  description?: string
  status?: string
  createdByName?: string
  updatedByName?: string
  created_at?: string
  updated_at?: string
  userId?: number | null
  username?: string
  password?: string
  mustChangePassword?: boolean
  full_name?: string
  national_id?: string
  gender?: string
  phone?: string
  email?: string
  physical_address?: string
  date_registered?: string
  partner_name?: string
  partner_type?: string
  partner_type_other?: string
  services_offered?: string[]
  services_offered_other?: string
  contact_person?: string
  address?: string
  operating_area?: string
  court_name?: string
  court_type?: string
  court_type_other?: string
}

type RelationshipTypeOption = {
  id: number
  name: string
  description?: string
  status?: string
  createdByName?: string
  updatedByName?: string
  created_at?: string
  updated_at?: string
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
    officerCode?: string
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

type ReferenceDataPreserve = Partial<{
  provinces: ProvinceOption[]
  districts: DistrictOption[]
  wards: WardOption[]
  organizations: OrganizationOption[]
  relationshipTypes: RelationshipTypeOption[]
}>

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

const protectionTypeSections = [
  { title: "Child Abuse", items: ["Sexual abuse", "Physical abuse", "Emotional abuse", "Neglect", "Child abandonment", "Child being bullied"] },
  { title: "Worst Forms of Child Labour", items: ["Hazardous labour", "Sexual exploitation", "Child trafficking"] },
  { title: "Alternative Care", items: ["Foster care", "Institutionalized child"] },
  { title: "Children Living Outside of Family Environment", items: ["Displaced child", "Child living/working on streets", "Child smuggling", "Unaccompanied child"] },
  { title: "Conflict with the Law", items: ["Child in conflict with the law", "Child in contact with the law custody"] },
  { title: "Child Marriage", items: ["Child married before legal age"] },
  { title: "Disability", items: ["Child with disability"] },
  { title: "HIV", items: ["Child living with HIV"] },
]

const welfareTypeSections = [
  { title: "Welfare Case Types", items: ["Child in need of birth registration/certificates", "Child in need of educational support", "Child in need of transport assistance (service access)", "Child is food insecure", "Child in need of medical support (e.g. in need of AMTO)", "Disabled child in need of devices"] },
]

const emergencyCaseTypeCodes: Record<string, string> = {
  "Sexual abuse": "SEXUAL_ABUSE", "Physical abuse": "PHYSICAL_ABUSE", "Emotional abuse": "EMOTIONAL_ABUSE", "Neglect": "NEGLECT",
  "Hazardous labour": "HAZARDOUS_LABOUR", "Sexual exploitation": "SEXUAL_EXPLOITATION", "Child trafficking": "CHILD_TRAFFICKING",
  "Child abandonment": "CHILD_ABANDONMENT", "Child living/working on streets": "CHILD_LIVING_WORKING_ON_STREETS", "Child smuggling": "CHILD_SMUGGLING",
  "Unaccompanied child": "UNACCOMPANIED_CHILD", "Child in conflict with the law": "CHILD_IN_CONFLICT_WITH_THE_LAW",
  "Child married before legal age": "CHILD_MARRIED_BEFORE_LEGAL_AGE", "Child in need of medical support (e.g. in need of AMTO)": "CHILD_IN_NEED_OF_MEDICAL_SUPPORT",
}

function calculateSafeguardingClassification(selectedCaseTypes: string[], existingImmediateDangerFlag: boolean) {
  const emergencyTriggers = selectedCaseTypes.filter((item) => Boolean(emergencyCaseTypeCodes[item]) || Object.values(emergencyCaseTypeCodes).includes(item))
  const classification: SafeguardingClassification = existingImmediateDangerFlag ? "IMMEDIATE_DANGER" : emergencyTriggers.length ? "EMERGENCY" : "NORMAL"
  return {
    classification,
    isEmergency: classification !== "NORMAL",
    isImmediateDanger: classification === "IMMEDIATE_DANGER",
    triggerCodes: [ ...(existingImmediateDangerFlag ? ["EXISTING_IMMEDIATE_DANGER"] : []), ...emergencyTriggers.map((item) => emergencyCaseTypeCodes[item] || item) ],
    triggerLabels: [ ...(existingImmediateDangerFlag ? ["Existing immediate-danger indicator"] : []), ...emergencyTriggers ],
  }
}

const allCaseTypeOptions = [
  ...protectionTypeSections.flatMap((section) => section.items),
  ...welfareTypeSections.flatMap((section) => section.items),
  "Other",
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
  is_emergency: false,
  is_immediate_danger: false,
  priority_level: "Normal",
  emergency_classification: "NON_EMERGENCY",
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

type GeoJsonFeature = {
  type: "Feature"
  properties: Record<string, string | number | null>
  geometry: unknown
}

type GeoJsonCollection = {
  type: "FeatureCollection"
  features: GeoJsonFeature[]
}

const zimbabweRegions: ZimRegion[] = [
  { name: "Harare Metropolitan", districts: ["Harare"], priority: "High", positions: [[-17.55, 30.75], [-17.55, 31.35], [-18.05, 31.45], [-18.2, 30.95], [-17.9, 30.62]] },
  { name: "Masvingo Province", districts: ["Masvingo", "Chiredzi"], priority: "High", positions: [[-19.5, 29.7], [-19.25, 32.2], [-21.9, 32.0], [-22.15, 30.1], [-20.95, 29.1]] },
  { name: "Midlands Province", districts: ["Gweru", "Kwekwe"], priority: "Medium", positions: [[-18.0, 28.0], [-17.6, 30.4], [-19.5, 29.7], [-20.3, 28.0], [-19.0, 27.2]] },
  { name: "Matabeleland North", districts: ["Hwange", "Binga"], priority: "Low", positions: [[-17.0, 25.2], [-17.1, 28.0], [-19.0, 27.2], [-20.2, 25.6], [-18.7, 24.8]] },
  { name: "Manicaland Province", districts: ["Mutare", "Chipinge"], priority: "Medium", positions: [[-17.65, 32.0], [-18.3, 33.1], [-21.1, 32.9], [-21.9, 32.0], [-19.25, 32.2]] },
  { name: "Bulawayo Metropolitan", districts: ["Bulawayo"], priority: "Medium", positions: [[-20.0, 28.35], [-20.0, 28.8], [-20.45, 28.85], [-20.55, 28.35]] },
]

const emptyGeoJsonCollection: GeoJsonCollection = { type: "FeatureCollection", features: [] }
const previewMapBoundaries = zimbabwePreviewGeoJson as { provinces: GeoJsonCollection; districts: GeoJsonCollection }

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
  const [relationshipTypes, setRelationshipTypes] = useState<RelationshipTypeOption[]>([])
  const referenceRequestRef = useRef(0)
  const [users, setUsers] = useState<ApiUser[]>([])
  const [apiError, setApiError] = useState("")
  const [externalView, setExternalView] = useState("dashboard")

  useEffect(() => {
    if (!apiError) return
    const timer = window.setTimeout(() => setApiError(""), 10_000)
    return () => window.clearTimeout(timer)
  }, [apiError])
  const [adminView, setAdminView] = useState("dashboard")
  const [selectedAlertId, setSelectedAlertId] = useState("")
  const [cases, setCases] = useState<CaseRecord[]>([])
  const [calendarTasks, setCalendarTasks] = useState<CalendarTask[]>([])
  const [lastOperationalRefreshAt, setLastOperationalRefreshAt] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<WorkflowNotification[]>([])
  const [selectedCaseId, setSelectedCaseId] = useState("")
  const [openAllocatedCaseId, setOpenAllocatedCaseId] = useState("")
  const [openIntakeCaseId, setOpenIntakeCaseId] = useState("")
  const [internalSidebarCollapsed, setInternalSidebarCollapsed] = useState(false)
  const operationalRefreshInFlightRef = useRef(false)

  const selectedAlert = alerts.find((alert) => alert.id === selectedAlertId) ?? alerts[0] ?? emptyAlert
  const selectedCase = cases.find((caseRecord) => caseRecord.id === selectedCaseId) ?? cases[0]

  async function refreshReferenceData(preserve: ReferenceDataPreserve = {}) {
    const requestId = ++referenceRequestRef.current
    const [locations, wardData, organizationData, relationshipTypeData] = await Promise.all([
      apiGet<{ provinces: ProvinceOption[]; districts: DistrictOption[] }>("/master-data/locations/"),
      apiGet<WardOption[]>("/wards/"),
      apiGet<OrganizationOption[]>("/organizations/"),
      apiGet<RelationshipTypeOption[]>("/relationship-types/"),
    ])
    const provinceData = locations.provinces
    const districtData = locations.districts
    const nextProvinceData = mergeById(provinceData, preserve.provinces || [], true)
    const nextDistrictData = mergeById(districtData, preserve.districts || [], true)
    const nextWardData = mergeById(wardData, preserve.wards || [], true)
    const nextOrganizationData = mergeById(organizationData, preserve.organizations || [], true)
    const nextRelationshipTypeData = mergeById(relationshipTypeData, preserve.relationshipTypes || [], true)
    // A later refresh (for example, opening User Management after creating
    // geography) must win over an earlier page-load response.
    if (requestId === referenceRequestRef.current) {
      setProvinces(nextProvinceData)
      setDistricts(nextDistrictData)
      setWards(nextWardData)
      setOrganizations(nextOrganizationData)
      setRelationshipTypes(nextRelationshipTypeData)
    }
    return { provinceData: nextProvinceData, districtData: nextDistrictData, wardData: nextWardData, organizationData: nextOrganizationData, relationshipTypeData: nextRelationshipTypeData }
  }

  useEffect(() => {
    if (isAdminPortalHost() && !window.location.pathname.startsWith("/login")) {
      window.history.replaceState(null, "", "/login")
    }
  }, [])

  useEffect(() => {
    if (!user) return
    const currentUserAccount = user
    async function loadReferenceData() {
      try {
        await refreshReferenceData()
      } catch {
        setProvinces([])
        setDistricts([])
        setWards([])
        setOrganizations([])
        setRelationshipTypes([])
      }
    }
    loadReferenceData()
  }, [user])

  useEffect(() => {
    if (!user) return
    void refreshOperationalData()
    if (user.profile.portal !== "internal") return
    const timer = window.setInterval(() => { void refreshOperationalData() }, 60_000)
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshOperationalData()
    }
    document.addEventListener("visibilitychange", refreshWhenVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
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

  async function refreshUsers(preserve: ApiUser[] = []) {
    try {
      const data = await apiGet<ApiUser[]>("/users/")
      const merged = mergeById(data, preserve, true)
      setUsers(merged)
      return merged
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not load district officers from API.")
      if (preserve.length) {
        setUsers((current) => mergeById(current, preserve, true))
        return preserve
      }
      setUsers([])
      return [] as ApiUser[]
    }
  }

  async function refreshCalendarTasks() {
    try {
      setCalendarTasks(await apiGet<CalendarTask[]>("/calendar-tasks/"))
    } catch (error) {
      setCalendarTasks([])
      setApiError(error instanceof Error ? error.message : "Could not load district calendar tasks from API.")
    }
  }

  async function refreshNotifications() {
    if (!user || user.profile.portal !== "internal") {
      setNotifications([])
      return [] as WorkflowNotification[]
    }
    try {
      const data = await apiGet<WorkflowNotification[]>("/notifications/?status=all")
      setNotifications(data)
      return data
    } catch {
      setNotifications([])
      return [] as WorkflowNotification[]
    }
  }

  async function resolveNotification(notification: WorkflowNotification) {
    if (typeof notification.id !== "number") return
    try {
      const updated = await apiPost<WorkflowNotification>(`/notifications/${notification.id}/resolve/`, {})
      setNotifications((items) => items.map((item) => item.id === updated.id ? updated : item))
    } catch {
      await refreshNotifications()
    }
  }

  async function login(username: string, password: string, loginPortal: "external" | "internal") {
    setApiError("")
    const session = await apiLogin(username, password, loginPortal)
    if ("passwordChangeRequired" in session) return session
    setExternalView("dashboard")
    setAdminView("dashboard")
    setSelectedAlertId("")
    setSelectedCaseId("")
    setOpenIntakeCaseId("")
    setUser(session.user)
    setApiError("")
    return session
  }

  async function changePassword(username: string, currentPassword: string, newPassword: string, confirmPassword: string, loginPortal: "external" | "internal") {
    setApiError("")
    const session = await apiChangePassword(username, currentPassword, newPassword, confirmPassword, loginPortal)
    setExternalView("dashboard")
    setAdminView("dashboard")
    setSelectedAlertId("")
    setSelectedCaseId("")
    setOpenIntakeCaseId("")
    setUser(session.user)
    setApiError("")
    return session
  }

  function logout() {
    apiLogout()
    setExternalView("dashboard")
    setAdminView("dashboard")
    setSelectedAlertId("")
    setSelectedCaseId("")
    setOpenIntakeCaseId("")
    setInternalSidebarCollapsed(false)
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
      await refreshNotifications()
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Workflow action failed.")
      await refreshAlerts()
      await refreshNotifications()
    }
  }

  async function refreshOperationalData() {
    if (!user || operationalRefreshInFlightRef.current) return
    operationalRefreshInFlightRef.current = true
    try {
      const requests = [
        apiGet<Array<AlertRecord & { districtName?: string; wardName?: string; reporterName?: string }>>("/alerts/"),
        ...(user.profile.portal === "internal" ? [
          apiGet<IntakeRecord[]>("/intakes/"),
          apiGet<ApiUser[]>("/users/"),
          apiGet<CalendarTask[]>("/calendar-tasks/"),
          apiGet<WorkflowNotification[]>("/notifications/?status=all"),
        ] : []),
      ] as const
      const results = await Promise.allSettled(requests)
      const alertsResult = results[0]
      let loadedAlerts = alerts
      if (alertsResult.status === "fulfilled") {
        loadedAlerts = alertsResult.value.map((alert) => ({ ...alert, district: alert.districtName || String(alert.district || ""), ward: alert.wardName || String(alert.ward || ""), reporter: alert.reporterName || alert.reporter }))
        setAlerts(loadedAlerts)
        if (loadedAlerts[0]) setSelectedAlertId(loadedAlerts[0].id)
      }
      if (user.profile.portal === "internal") {
        const [intakesResult, usersResult, tasksResult, notificationsResult] = results.slice(1)
        if (intakesResult?.status === "fulfilled") {
          const normalizedCases = (intakesResult.value as IntakeRecord[]).map((intake) => caseFromIntake(intake, loadedAlerts, districts))
          setCases(normalizedCases)
          if (normalizedCases[0] && !selectedCaseId) setSelectedCaseId(normalizedCases[0].id)
        }
        if (usersResult?.status === "fulfilled") setUsers(usersResult.value as ApiUser[])
        if (tasksResult?.status === "fulfilled") setCalendarTasks(tasksResult.value as CalendarTask[])
        if (notificationsResult?.status === "fulfilled") setNotifications(notificationsResult.value as WorkflowNotification[])
      }
      const failedSources = results.flatMap((result, index) => result.status === "rejected" ? [["alerts", "cases", "officers", "calendar", "notifications"][index] || "dashboard data"] : [])
      if (failedSources.length) {
        setApiError(`Some dashboard information could not be reached (${failedSources.join(", ")}). Existing information has been kept; refresh to try again.`)
      } else {
        setApiError("")
      }
      setLastOperationalRefreshAt(new Date().toISOString())
    } finally {
      operationalRefreshInFlightRef.current = false
    }
  }

  async function assessAlertValidity(alert: AlertRecord, isValid: boolean, reason = "") {
    setApiError("")
    try {
      const updated = await apiPost<AlertRecord>(`/alerts/${alert.id}/triage/`, { action: "validate", is_valid: isValid, reason })
      setAlerts((items) => items.map((item) => item.id === updated.id ? updated : item))
      await refreshNotifications()
      if (isValid) await convertAlertToDraftCase(updated)
      else await refreshAlerts()
      return true
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not record the alert validity decision.")
      await refreshAlerts()
      return false
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
    await refreshNotifications()
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

  function openAllocatedCase(caseRecord: CaseRecord) {
    setSelectedCaseId(caseRecord.id)
    setOpenAllocatedCaseId(caseRecord.id)
    setAdminView("allocated-cases")
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

  async function submitAlert(draft: Pick<AlertRecord, "childName" | "sex" | "age" | "district" | "ward" | "concern" | "description"> & {
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
    concern_categories?: string[]
    village_suburb?: string
    chief_name?: string
    nearest_landmark?: string
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
    alleged_perpetrator_known?: string
    alleged_perpetrator_sex?: string
    alleged_perpetrator_race?: string
    perpetrator_has_access?: string
    referred_to_police?: string
    police_referral_date?: string | null
    court_appearance_scheduled?: string
    court_appearance_date?: string | null
    conviction_determined?: string
    conviction_date?: string | null
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
        village_suburb: draft.village_suburb || "",
        chief_name: draft.chief_name || "",
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
        alleged_perpetrator_known: draft.alleged_perpetrator_known || "",
        alleged_perpetrator_name: draft.alleged_perpetrator_known === "Yes" ? draft.alleged_perpetrator_name || "" : "",
        alleged_perpetrator_relationship: draft.alleged_perpetrator_known === "Yes" ? draft.alleged_perpetrator_relationship || "" : "",
        alleged_perpetrator_sex: draft.alleged_perpetrator_known === "Yes" ? draft.alleged_perpetrator_sex || "" : "",
        alleged_perpetrator_race: draft.alleged_perpetrator_known === "Yes" ? draft.alleged_perpetrator_race || "" : "",
        perpetrator_has_access: draft.alleged_perpetrator_known === "Yes" ? draft.perpetrator_has_access || "" : "",
        referred_to_police: draft.referred_to_police || "",
        police_referral_date: draft.police_referral_date || null,
        court_appearance_scheduled: draft.court_appearance_scheduled || "",
        court_appearance_date: draft.court_appearance_date || null,
        conviction_determined: draft.conviction_determined || "",
        conviction_date: draft.conviction_date || null,
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
        concern_categories: draft.concern_categories?.length ? draft.concern_categories : splitAlertConcern(draft.concern),
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
      {portal === "external" ? (
        <ExternalPortal alerts={alerts} onSubmitAlert={submitAlert} onAdmin={goToAdmin} view={externalView} setView={setExternalView} user={user} login={login} changePassword={changePassword} logout={logout} apiError={apiError} districts={districts} wards={wards} relationshipTypes={relationshipTypes} />
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
          assessAlertValidity={assessAlertValidity}
          convertAlertToDraftCase={convertAlertToDraftCase}
          saveDraftCase={saveDraftCase}
          discardDraftCase={discardDraftCase}
          openFullIntake={openFullIntake}
          openAllocatedCase={openAllocatedCase}
          openAllocatedCaseId={openAllocatedCaseId}
          clearOpenAllocatedCaseId={() => setOpenAllocatedCaseId("")}
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
          relationshipTypes={relationshipTypes}
          refreshReferenceData={refreshReferenceData}
          refreshUsers={refreshUsers}
          refreshAlerts={refreshAlerts}
          refreshIntakes={refreshIntakes}
          refreshNotifications={refreshNotifications}
          refreshOperationalData={refreshOperationalData}
          lastOperationalRefreshAt={lastOperationalRefreshAt}
          notifications={notifications}
          resolveNotification={resolveNotification}
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
  relationshipTypes,
}: {
  alerts: AlertRecord[]
  onSubmitAlert: (draft: Pick<AlertRecord, "childName" | "sex" | "age" | "district" | "ward" | "concern" | "description"> & {
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
    concern_categories?: string[]
    village_suburb?: string
    chief_name?: string
    nearest_landmark?: string
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
    alleged_perpetrator_known?: string
    alleged_perpetrator_sex?: string
    alleged_perpetrator_race?: string
    perpetrator_has_access?: string
    referred_to_police?: string
    police_referral_date?: string | null
    court_appearance_scheduled?: string
    court_appearance_date?: string | null
    conviction_determined?: string
    conviction_date?: string | null
    is_emergency?: boolean
    is_immediate_danger?: boolean
    priority_level?: string
    emergency_classification?: EmergencyClassification
    immediate_action_plan?: string
    immediate_action_at?: string | null
    immediate_action_responsible?: string
    immediate_action_status?: string
    supervisor_notified?: string
    supervisor_notification_at?: string | null
    supervisor_notified_no_reason?: string
    child_moved_to_safety?: string
    referral_authority_contacted?: string
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
  relationshipTypes: RelationshipTypeOption[]
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
              <h1 className="truncate text-lg font-bold text-[#263747]">NCPMIS Public Portal</h1>
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
        {view === "raise" && <AlertForm onSubmitAlert={onSubmitAlert} onSubmittedOk={() => setView("dashboard")} districts={districts} relationshipTypes={relationshipTypes} user={user} />}
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
  relationshipTypes,
  user,
}: {
  onSubmitAlert: (draft: Pick<AlertRecord, "childName" | "sex" | "age" | "district" | "ward" | "concern" | "description"> & {
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
    concern_categories?: string[]
    village_suburb?: string
    chief_name?: string
    nearest_landmark?: string
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
    alleged_perpetrator_known?: string
    alleged_perpetrator_sex?: string
    alleged_perpetrator_race?: string
    perpetrator_has_access?: string
    referred_to_police?: string
    police_referral_date?: string | null
    court_appearance_scheduled?: string
    court_appearance_date?: string | null
    conviction_determined?: string
    conviction_date?: string | null
    is_emergency?: boolean
    is_immediate_danger?: boolean
    priority_level?: string
    emergency_classification?: EmergencyClassification
    immediate_action_plan?: string
    immediate_action_at?: string | null
    immediate_action_responsible?: string
    immediate_action_status?: string
    supervisor_notified?: string
    supervisor_notification_at?: string | null
    supervisor_notified_no_reason?: string
    child_moved_to_safety?: string
    referral_authority_contacted?: string
  }) => Promise<AlertRecord>
  onSubmittedOk: () => void
  districts: DistrictOption[]
  relationshipTypes: RelationshipTypeOption[]
  user: ApiUser
}) {
  const accountDistrict = user.profile.districtName || ""
  const accountWard = user.profile.wardName || ""
  const accountProvince = user.profile.provinceName || districts.find((district) => district.name === accountDistrict)?.provinceName || ""
  const draftStorageKey = `ncms:public-alert-draft:${user.id}`
  const [step, setStep] = useState(0)
  const formTopRef = useRef<HTMLDivElement | null>(null)
  const restoredDraftRef = useRef(false)
  const [draft, setDraft] = useState({
    intake_source: "ALERT",
    date_reported: new Date().toISOString().slice(0, 10),
    reporting_channel: "Public portal",
    district: accountDistrict,
    ward: accountWard,
    village: "",
    chief_name: "",
    nearest_landmark: "",
    informant_surname: "",
    informant_first_names: "",
    informant_id_number: "",
    informant_sex: "",
    informant_address: "",
    informant_relationship_to_child: "",
    informant_phone: "",
    informant_email: "",
    informant_organization: "",
    other_background_information: "",
    child_known: "",
    child_first_name: "",
    child_surname: "",
    sex: "",
    age: "",
    birth_registered: "",
    disability: "",
    concern: "",
    alleged_perpetrator_known: "",
    alleged_perpetrator_name: "",
    alleged_perpetrator_relationship: "",
    alleged_perpetrator_sex: "",
    alleged_perpetrator_race: "",
    referred_to_police: "",
    police_referral_date: "",
    court_appearance_scheduled: "",
    court_appearance_date: "",
    conviction_determined: "",
    conviction_date: "",
  })
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [openConcernSections, setOpenConcernSections] = useState<string[]>([])
  const [declarationAccepted, setDeclarationAccepted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [publicErrors, setPublicErrors] = useState<string[]>([])
  const [submittedAlert, setSubmittedAlert] = useState<AlertRecord | null>(null)
  const [autosaveState, setAutosaveState] = useState<"idle" | "waiting" | "saving" | "saved" | "error">("idle")
  const [autosavedAt, setAutosavedAt] = useState("")
  const steps = ["Capturer & Informant", "Child", "Case Type", "Summary"]
  const publicConcernItems = [...protectionTypeSections.flatMap((section) => section.items), ...welfareTypeSections.flatMap((section) => section.items)]
  const sexualAbuseSelected = selectedCategories.includes("Sexual abuse")

  function publicConcernSelection(items: string[]) {
    return items.filter((item) => publicConcernItems.includes(item))
  }

  function capturedCount(keys: string[]) {
    return keys.filter((key) => {
      const value = draft[key as keyof typeof draft]
      return typeof value === "string" ? value.trim() : Boolean(value)
    }).length
  }

  function hasEnoughForAutosave() {
    const informantCount = capturedCount(["informant_surname", "informant_first_names", "informant_phone"])
    const childCount = capturedCount(["child_known", "child_first_name", "child_surname", "sex", "age", "village", "chief_name", "nearest_landmark"])
    const concernCount = selectedCategories.length + capturedCount(["other_background_information"])
    return informantCount >= 2 || childCount >= 2 || concernCount >= 2
  }

  useEffect(() => {
    if (restoredDraftRef.current) return
    restoredDraftRef.current = true
    try {
      const saved = window.localStorage.getItem(draftStorageKey)
      if (!saved) return
      const parsed = JSON.parse(saved) as { draft?: Partial<typeof draft>; selectedCategories?: string[]; declarationAccepted?: boolean; step?: number; autosavedAt?: string }
      if (parsed.draft) setDraft((current) => ({ ...current, ...parsed.draft }))
      if (Array.isArray(parsed.selectedCategories)) setSelectedCategories(publicConcernSelection(parsed.selectedCategories))
      if (typeof parsed.declarationAccepted === "boolean") setDeclarationAccepted(parsed.declarationAccepted)
      if (typeof parsed.step === "number") setStep(Math.min(steps.length - 1, Math.max(0, parsed.step)))
      if (parsed.autosavedAt) {
        setAutosavedAt(parsed.autosavedAt)
        setAutosaveState("saved")
      }
    } catch {
      setAutosaveState("error")
    }
  }, [draftStorageKey, steps.length])

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      date_reported: new Date().toISOString().slice(0, 10),
      reporting_channel: "Public portal",
      district: accountDistrict,
      ward: accountWard,
    }))
  }, [accountDistrict, accountWard])

  useEffect(() => {
    if (!restoredDraftRef.current) return
    if (step < 1) {
      setAutosaveState(hasEnoughForAutosave() ? "waiting" : "idle")
      return
    }
    if (!hasEnoughForAutosave()) {
      setAutosaveState("waiting")
      return
    }

    setAutosaveState("saving")
    const timer = window.setTimeout(() => {
      try {
        const savedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        window.localStorage.setItem(draftStorageKey, JSON.stringify({
          draft,
          selectedCategories,
          declarationAccepted,
          step,
          autosavedAt: savedAt,
        }))
        setAutosavedAt(savedAt)
        setAutosaveState("saved")
      } catch {
        setAutosaveState("error")
      }
    }, 700)
    return () => window.clearTimeout(timer)
  }, [declarationAccepted, draft, draftStorageKey, selectedCategories, step])

  useEffect(() => {
    if (step === 2) setOpenConcernSections(sexualAbuseSelected ? ["prosecution"] : [])
  }, [step, sexualAbuseSelected])

  useEffect(() => {
    setOpenConcernSections((current) => {
      if (sexualAbuseSelected) return current.includes("prosecution") ? current : [...current, "prosecution"]
      return current.filter((section) => section !== "prosecution")
    })
  }, [sexualAbuseSelected])

  function toggleCategory(item: string) {
    setSelectedCategories((items) => {
      const next = items.includes(item) ? items.filter((value) => value !== item) : [...items, item]
      setDraft((current) => ({ ...current, concern: next[0] || "" }))
      return next
    })
  }

  function toggleConcernSection(section: string) {
    setOpenConcernSections((sections) => sections.includes(section) ? sections.filter((item) => item !== section) : [...sections, section])
  }

  function selectedConcernCount(items: string[]) {
    return items.filter((item) => selectedCategories.includes(item)).length
  }

  function setDraftValue(key: string, value: string) {
    if (key === "child_known" && value === "No") {
      setDraft((current) => ({
        ...current,
        child_known: "No",
        child_first_name: "",
        child_surname: "",
        sex: "",
        age: "",
        birth_registered: "",
        disability: "",
      }))
      return
    }
    if (key === "alleged_perpetrator_known" && value !== "Yes") {
      setDraft((current) => ({
        ...current,
        alleged_perpetrator_known: value,
        alleged_perpetrator_name: "",
        alleged_perpetrator_relationship: "",
        alleged_perpetrator_sex: "",
        alleged_perpetrator_race: "",
      }))
      return
    }
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function goToStep(nextStep: number) {
    setStep(Math.min(steps.length - 1, Math.max(0, nextStep)))
    window.requestAnimationFrame(() => {
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }

  async function submitPublicAlert() {
    if (!declarationAccepted || submitting) return
    const nextErrors: string[] = []
    if (!draft.informant_surname.trim()) nextErrors.push("Informant surname is required.")
    if (!draft.informant_first_names.trim()) nextErrors.push("Informant first names are required.")
    if (!draft.informant_sex) nextErrors.push("Informant sex is required.")
    if (!draft.informant_relationship_to_child) nextErrors.push("Informant relationship to child is required.")
    if (!draft.informant_phone.trim()) nextErrors.push("Informant phone is required.")
    if (sexualAbuseSelected && !draft.alleged_perpetrator_known) nextErrors.push("Perpetrator known is required for the selected case type.")
    if (sexualAbuseSelected && draft.alleged_perpetrator_known === "Yes" && !draft.alleged_perpetrator_name.trim()) nextErrors.push("Accused name is required when perpetrator known is Yes.")
    if (nextErrors.length) {
      setPublicErrors(nextErrors)
      goToStep(nextErrors.some((error) => error.startsWith("Informant")) ? 0 : 2)
      return
    }
    setPublicErrors([])
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
        concern_categories: submittedConcernCategories,
        description: submittedDescription,
        intake_source: draft.intake_source,
        reporting_channel: draft.reporting_channel,
        information_source_type: draft.informant_organization,
        information_source_name: [draft.informant_first_names, draft.informant_surname].filter(Boolean).join(" "),
        information_source_surname: draft.informant_surname,
        information_source_first_names: draft.informant_first_names,
        information_source_id_number: draft.informant_id_number,
        information_source_sex: draft.informant_sex,
        information_source_contact: draft.informant_phone,
        information_source_email: draft.informant_email,
        information_source_address: draft.informant_address,
        information_source_relationship_to_child: draft.informant_relationship_to_child,
        village_suburb: draft.village,
        chief_name: draft.chief_name,
        nearest_landmark: draft.nearest_landmark,
        birth_registered: draft.birth_registered,
        disability: draft.disability,
        alleged_perpetrator_known: draft.alleged_perpetrator_known,
        alleged_perpetrator_name: draft.alleged_perpetrator_name,
        alleged_perpetrator_relationship: draft.alleged_perpetrator_relationship,
        alleged_perpetrator_sex: draft.alleged_perpetrator_sex,
        alleged_perpetrator_race: draft.alleged_perpetrator_race,
        referred_to_police: draft.referred_to_police,
        police_referral_date: draft.police_referral_date || null,
        court_appearance_scheduled: draft.court_appearance_scheduled,
        court_appearance_date: draft.court_appearance_date || null,
        conviction_determined: draft.conviction_determined,
        conviction_date: draft.conviction_date || null,
      })
      setPublicErrors([])
      setSubmittedAlert(created)
      window.localStorage.removeItem(draftStorageKey)
      setAutosaveState("idle")
      setAutosavedAt("")
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
    ...selectedCategories,
  ].join(", ") || "Uncategorized"
  const submittedConcernCategories = splitAlertConcern(submittedConcern).filter((item) => item !== "Uncategorized")
  const submittedDescription = draft.other_background_information
  const childDetailsEditable = draft.child_known === "Yes"
  const autosaveLabel = autosaveState === "saving" ? "Autosaving..." : autosaveState === "saved" ? `Autosaved${autosavedAt ? ` ${autosavedAt}` : ""}` : autosaveState === "error" ? "Autosave failed" : ""

  return (
    <Panel title="Raise New Alert" icon={ShieldAlert} action={<span className="inline-flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-semibold text-[#475569]">Step {step + 1} of {steps.length}</span>{autosaveLabel && <span className={`rounded-full px-3 py-1 text-xs font-bold ${autosaveState === "error" ? "bg-[#fee4e2] text-[#b42318]" : autosaveState === "saved" ? "bg-[#e7f6f3] text-[#007464]" : "bg-[#fff4d6] text-[#a05b16]"}`}>{autosaveLabel}</span>}</span>}>
      <div ref={formTopRef} className="scroll-mt-4" />
      <div className="mb-5 flex flex-wrap gap-2 border-b border-[#d8dee8] pb-3">
        {steps.map((label, index) => (
          <button
            key={label}
            className={`min-h-11 flex-1 rounded-md border px-3 text-sm font-semibold sm:flex-none sm:min-w-[150px] ${index === step ? "border-[#008c7a] bg-[#008c7a] text-white" : "border-[#d8dee8] bg-white text-[#50617a]"}`}
            onClick={() => goToStep(index)}
          >
            {label}
          </button>
        ))}
      </div>

      {publicErrors.length > 0 && <div className="mb-4 rounded-md border border-[#f4b4ac] bg-[#fff7f5] px-4 py-3 text-sm font-semibold text-[#b42318]">{publicErrors.map((error) => <div key={error}>{error}</div>)}</div>}

      {step === 0 && (
        <div className="space-y-4">
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <h3 className="mb-3 text-base font-bold text-[#263747]">Capturer details</h3>
            <FormGrid>
              <ReadonlyField label="Capturer name" value={[user.first_name, user.last_name].filter(Boolean).join(" ") || user.username} />
              <ReadonlyField label="Designation" value={user.profile.roleLabel} />
              <ReadonlyField label="Province" value={accountProvince || "Not assigned"} />
              <ReadonlyField label="District" value={accountDistrict || "Not assigned"} />
              <ReadonlyField label="Ward" value={accountWard || "Not assigned"} />
              <ReadonlyField label="Reporting channel" value="Public portal" />
            </FormGrid>
          </section>
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <h3 className="mb-3 text-base font-bold text-[#263747]">Informant details</h3>
            <FormGrid>
              <Field label="Surname" required><input className={inputClass} value={draft.informant_surname} onChange={(e) => setDraftValue("informant_surname", e.target.value)} /></Field>
              <Field label="First names" required><input className={inputClass} value={draft.informant_first_names} onChange={(e) => setDraftValue("informant_first_names", e.target.value)} /></Field>
              <Field label="National ID number"><input className={inputClass} value={draft.informant_id_number} onChange={(e) => setDraftValue("informant_id_number", e.target.value)} /></Field>
              <Field label="Sex" required><select className={inputClass} value={draft.informant_sex} onChange={(e) => setDraftValue("informant_sex", e.target.value)}><option value="">Select sex</option><option>MALE</option><option>FEMALE</option><option>UNKNOWN</option></select></Field>
              <Field label="Relationship to child" required><RelationshipSelect value={draft.informant_relationship_to_child} onChange={(value) => setDraftValue("informant_relationship_to_child", value)} relationshipTypes={relationshipTypes} /></Field>
              <Field label="Phone" required><input className={inputClass} value={draft.informant_phone} onChange={(e) => setDraftValue("informant_phone", e.target.value)} placeholder="+263 ..." /></Field>
              <Field label="Email"><input className={inputClass} type="email" value={draft.informant_email} onChange={(e) => setDraftValue("informant_email", e.target.value)} /></Field>
              <Field label="Organisation"><input className={inputClass} value={draft.informant_organization} onChange={(e) => setDraftValue("informant_organization", e.target.value)} /></Field>
              <div className="md:col-span-2"><Field label="Address" required={false}><textarea className={`${inputClass} min-h-[90px] py-3`} value={draft.informant_address} onChange={(e) => setDraftValue("informant_address", e.target.value)} /></Field></div>
            </FormGrid>
          </section>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <h3 className="mb-3 text-base font-bold text-[#263747]">Child Details</h3>
            <FormGrid>
              <Field label="Child known"><select className={inputClass} value={draft.child_known} onChange={(e) => setDraftValue("child_known", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
              <Field label="Child first name"><input className={`${inputClass} ${!childDetailsEditable ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={draft.child_first_name} onChange={(e) => setDraftValue("child_first_name", e.target.value)} disabled={!childDetailsEditable} /></Field>
              <Field label="Child surname"><input className={`${inputClass} ${!childDetailsEditable ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={draft.child_surname} onChange={(e) => setDraftValue("child_surname", e.target.value)} disabled={!childDetailsEditable} /></Field>
              <Field label="Sex"><select className={`${inputClass} ${!childDetailsEditable ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={draft.sex} onChange={(e) => setDraftValue("sex", e.target.value)} disabled={!childDetailsEditable}><option value="">Select sex</option><option>Female</option><option>Male</option><option>Unknown</option></select></Field>
              <Field label="Age"><input className={`${inputClass} ${!childDetailsEditable ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={draft.age} onChange={(e) => setDraftValue("age", e.target.value)} placeholder="Enter age or estimated age" disabled={!childDetailsEditable} /></Field>
              <Field label="Birth registered"><select className={`${inputClass} ${!childDetailsEditable ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={draft.birth_registered} onChange={(e) => setDraftValue("birth_registered", e.target.value)} disabled={!childDetailsEditable}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
              <Field label="Disability"><select className={`${inputClass} ${!childDetailsEditable ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={draft.disability} onChange={(e) => setDraftValue("disability", e.target.value)} disabled={!childDetailsEditable}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
              <div className="md:col-span-2"><h4 className="mt-2 border-t border-[#edf0f4] pt-4 text-sm font-bold uppercase tracking-wide text-[#2e6fa3]">Child Location</h4></div>
              <ReadonlyField label="Province" value={accountProvince || "Not assigned"} />
              <ReadonlyField label="District" value={accountDistrict || "Not assigned"} />
              <ReadonlyField label="Ward" value={accountWard || "Not assigned"} />
              <Field label="Village"><input className={inputClass} value={draft.village} onChange={(e) => setDraftValue("village", e.target.value)} /></Field>
              <Field label="Chief name"><input className={inputClass} value={draft.chief_name} onChange={(e) => setDraftValue("chief_name", e.target.value)} /></Field>
              <Field label="Nearest landmark"><input className={inputClass} value={draft.nearest_landmark} onChange={(e) => setDraftValue("nearest_landmark", e.target.value)} placeholder="School, clinic, shop, church, road, or known place nearby" /></Field>
            </FormGrid>
          </section>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <div className="mb-4">
              <h3 className="text-[20px] font-bold text-[#10233f]">Case Type</h3>
            </div>
            <div className="space-y-3">
              <ConcernAccordion
                title="Protection Case Types"
                selectedCount={selectedConcernCount(protectionTypeSections.flatMap((section) => section.items))}
                open={openConcernSections.includes("protection")}
                onToggle={() => toggleConcernSection("protection")}
              >
                <CaseTypeSection title="Protection Case Types" sections={protectionTypeSections} selected={selectedCategories} onToggle={toggleCategory} />
              </ConcernAccordion>
              <ConcernAccordion
                title="Welfare Case Types"
                selectedCount={selectedConcernCount(welfareTypeSections.flatMap((section) => section.items))}
                open={openConcernSections.includes("welfare")}
                onToggle={() => toggleConcernSection("welfare")}
              >
                <CaseTypeSection title="Welfare Case Types" sections={welfareTypeSections} selected={selectedCategories} onToggle={toggleCategory} />
              </ConcernAccordion>
              <div className="border-t border-[#edf0f4] pt-4">
                <Field label="Other Background Information" required={false}><textarea className={`${inputClass} min-h-[110px] py-3`} value={draft.other_background_information} onChange={(event) => setDraftValue("other_background_information", event.target.value)} /></Field>
              </div>
            </div>
          </section>
          {sexualAbuseSelected && (
            <section className="overflow-hidden rounded-md border border-[#d8dee8] bg-white">
              <button type="button" className="flex w-full items-center justify-between gap-3 bg-[#f8fafc] px-4 py-4 text-left hover:bg-[#f1f5f9]" onClick={() => toggleConcernSection("prosecution")} aria-expanded={openConcernSections.includes("prosecution")}>
                <span className="block text-sm font-bold uppercase text-[#2e6fa3]">Prosecution / Alleged Perpetrator</span>
                <span className="inline-flex shrink-0 items-center gap-2">
                  <StatusPill label="Required for selected category" tone="warning" />
                  <ChevronDown className={`h-5 w-5 text-[#5f7191] transition ${openConcernSections.includes("prosecution") ? "rotate-180" : ""}`} />
                </span>
              </button>
              {openConcernSections.includes("prosecution") && (
                <div className="border-t border-[#d8dee8] p-4">
                  <FormGrid>
                    <Field label="Perpetrator known" required><select className={inputClass} value={draft.alleged_perpetrator_known} onChange={(e) => setDraftValue("alleged_perpetrator_known", e.target.value)} required><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                    {draft.alleged_perpetrator_known === "Yes" && (
                      <>
                        <Field label="Accused name" required><input className={inputClass} value={draft.alleged_perpetrator_name} onChange={(e) => setDraftValue("alleged_perpetrator_name", e.target.value)} required /></Field>
                        <Field label="Relationship to child"><RelationshipSelect value={draft.alleged_perpetrator_relationship} onChange={(value) => setDraftValue("alleged_perpetrator_relationship", value)} relationshipTypes={relationshipTypes} /></Field>
                        <Field label="Accused sex"><select className={inputClass} value={draft.alleged_perpetrator_sex} onChange={(e) => setDraftValue("alleged_perpetrator_sex", e.target.value)}><option value="">Select sex</option><option>MALE</option><option>FEMALE</option><option>UNKNOWN</option></select></Field>
                        <Field label="Race"><select className={inputClass} value={draft.alleged_perpetrator_race} onChange={(e) => setDraftValue("alleged_perpetrator_race", e.target.value)}><option value="">Select race</option><option>BLACK</option><option>WHITE</option><option>COLOURED</option></select></Field>
                      </>
                    )}
                    <Field label="Referred to police"><select className={inputClass} value={draft.referred_to_police} onChange={(e) => setDraftValue("referred_to_police", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                    {draft.referred_to_police === "Yes" && <Field label="Police referral date"><input className={inputClass} type="date" value={draft.police_referral_date} onChange={(e) => setDraftValue("police_referral_date", e.target.value)} /></Field>}
                    <Field label="Court appearance scheduled"><select className={inputClass} value={draft.court_appearance_scheduled} onChange={(e) => setDraftValue("court_appearance_scheduled", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                    {draft.court_appearance_scheduled === "Yes" && <Field label="Court appearance date"><input className={inputClass} type="date" value={draft.court_appearance_date} onChange={(e) => setDraftValue("court_appearance_date", e.target.value)} /></Field>}
                    <Field label="Conviction determined"><select className={inputClass} value={draft.conviction_determined} onChange={(e) => setDraftValue("conviction_determined", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                    {draft.conviction_determined === "Yes" && <Field label="Conviction date"><input className={inputClass} type="date" value={draft.conviction_date} onChange={(e) => setDraftValue("conviction_date", e.target.value)} /></Field>}
                  </FormGrid>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <h3 className="mb-4 text-lg font-bold text-[#263747]">Capturer details</h3>
            <SummaryFieldGrid items={[
              ["Capturer name", [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username],
              ["Designation", user.profile.roleLabel],
              ["Reporting channel", "Public portal"],
            ]} />
          </section>
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <h3 className="mb-4 text-lg font-bold text-[#263747]">Informant details</h3>
            <SummaryFieldGrid items={[
              ["Surname", draft.informant_surname],
              ["First names", draft.informant_first_names],
              ["National ID number", draft.informant_id_number],
              ["Sex", draft.informant_sex],
              ["Relationship to child", draft.informant_relationship_to_child],
              ["Phone", draft.informant_phone],
              ["Email", draft.informant_email],
              ["Organisation", draft.informant_organization],
              ["Address", draft.informant_address],
            ]} />
          </section>
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <h3 className="mb-4 text-lg font-bold text-[#263747]">Child details</h3>
            <SummaryFieldGrid items={[
              ["Child known", draft.child_known],
              ["First name", submittedChildFirstName],
              ["Surname", submittedChildSurname],
              ["Sex", submittedSex],
              ["Age", submittedAge],
              ["Birth registered", draft.birth_registered],
              ["Disability", draft.disability],
            ]} />
          </section>
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <h3 className="mb-4 text-lg font-bold text-[#263747]">Child location</h3>
            <SummaryFieldGrid items={[
              ["Province", accountProvince],
              ["District", accountDistrict],
              ["Ward", accountWard],
              ["Village", draft.village],
              ["Chief name", draft.chief_name],
              ["Nearest landmark", draft.nearest_landmark],
            ]} />
          </section>
          <section className="rounded-md border border-[#d8dee8] bg-white p-4">
            <h3 className="mb-4 text-lg font-bold text-[#263747]">Case type details</h3>
            <SummaryFieldGrid items={[
              ["Selected case types", submittedConcern],
              ["Other background information", submittedDescription],
            ]} />
          </section>
          {sexualAbuseSelected && (
            <section className="rounded-md border border-[#d8dee8] bg-white p-4">
              <h3 className="mb-4 text-lg font-bold text-[#263747]">Alleged perpetrator</h3>
              <SummaryFieldGrid items={[
                ["Perpetrator known", draft.alleged_perpetrator_known],
                ["Name", draft.alleged_perpetrator_name],
                ["Relationship to child", draft.alleged_perpetrator_relationship],
                ["Sex", draft.alleged_perpetrator_sex],
                ["Race", draft.alleged_perpetrator_race],
                ["Referred to police", draft.referred_to_police],
                ["Police referral date", draft.police_referral_date],
                ["Court appearance scheduled", draft.court_appearance_scheduled],
                ["Court appearance date", draft.court_appearance_date],
                ["Conviction determined", draft.conviction_determined],
                ["Conviction date", draft.conviction_date],
              ]} />
            </section>
          )}
          <label className="flex items-center gap-3 rounded-md bg-[#f8fafc] p-3 text-sm">
            <input type="checkbox" checked={declarationAccepted} onChange={(event) => setDeclarationAccepted(event.target.checked)} className="h-5 w-5 accent-[#008c7a]" />
            Information is true to the best of my knowledge and submitted for child protection/welfare purposes.
          </label>
        </div>
      )}

      <div className="mt-6 flex flex-wrap justify-between gap-3 border-t border-[#dfe4eb] pt-4">
        <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 text-sm font-semibold" onClick={() => goToStep(step - 1)}>Back</button>
        {step < steps.length - 1 ? (
          <button className="inline-flex items-center gap-2 rounded-md bg-[#008c7a] px-5 py-2 text-sm font-semibold text-white" onClick={() => goToStep(step + 1)}>Next <ArrowRight className="h-4 w-4" /></button>
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
  assessAlertValidity,
  convertAlertToDraftCase,
  saveDraftCase,
  discardDraftCase,
  openFullIntake,
  openAllocatedCase,
  openAllocatedCaseId,
  clearOpenAllocatedCaseId,
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
  relationshipTypes,
  refreshReferenceData,
  refreshUsers,
  refreshAlerts,
  refreshIntakes,
  refreshNotifications,
  refreshOperationalData,
  lastOperationalRefreshAt,
  notifications,
  resolveNotification,
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
  assessAlertValidity: (alert: AlertRecord, isValid: boolean, reason?: string) => Promise<boolean>
  convertAlertToDraftCase: (alert: AlertRecord) => void | Promise<void>
  saveDraftCase: (caseRecord: CaseRecord, options?: SaveDraftCaseOptions) => void
  discardDraftCase: (caseRecord: CaseRecord) => void
  openFullIntake: (caseRecord: CaseRecord) => void
  openAllocatedCase: (caseRecord: CaseRecord) => void
  openAllocatedCaseId: string
  clearOpenAllocatedCaseId: () => void
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
  relationshipTypes: RelationshipTypeOption[]
  refreshReferenceData: (preserve?: ReferenceDataPreserve) => Promise<{ provinceData: ProvinceOption[]; districtData: DistrictOption[]; wardData: WardOption[]; organizationData: OrganizationOption[]; relationshipTypeData: RelationshipTypeOption[] }>
  refreshUsers: (preserve?: ApiUser[]) => Promise<ApiUser[]>
  refreshAlerts: () => Promise<AlertRecord[]>
  refreshIntakes: (alertSource?: AlertRecord[], districtSource?: DistrictOption[]) => Promise<CaseRecord[]>
  refreshNotifications: () => Promise<WorkflowNotification[]>
  refreshOperationalData: () => Promise<void>
  lastOperationalRefreshAt: string | null
  notifications: WorkflowNotification[]
  resolveNotification: (notification: WorkflowNotification) => Promise<void>
  saveCalendarTasks: (tasks: CalendarTask[]) => Promise<void>
  sidebarCollapsed: boolean
  setSidebarCollapsed: (value: boolean) => void
  openIntakeCaseId: string
  clearOpenIntakeCaseId: () => void
}) {
  const [caseIntakeNavigationKey, setCaseIntakeNavigationKey] = useState(0)
  const [caseQueueNavigationKey, setCaseQueueNavigationKey] = useState(0)
  const derivedNotifications = user?.profile.portal === "internal" ? buildWorkflowNotifications(user, alerts, cases) : []
  const workflowNotifications = notifications.length ? notifications : derivedNotifications
  const metrics: Metric[] = [
    { label: "New alerts", value: alerts.filter((a) => a.internalStatus === "Alert Submitted").length, icon: Inbox, tone: "bg-[#2e6fa3]" },
    { label: "Emergency", value: alerts.filter((a) => a.emergency).length, icon: ShieldAlert, tone: "bg-[#b42318]" },
    { label: "Supervisor review", value: alerts.filter((a) => a.internalStatus === "Pending Supervisor Review").length, icon: ClipboardCheck, tone: "bg-[#7c4d9e]" },
    { label: "Unallocated", value: alerts.filter((a) => a.internalStatus === "Approved for Allocation").length, icon: Users, tone: "bg-[#a05b16]" },
  ]

  useEffect(() => {
    if (["services", "events"].includes(view)) setView("dashboard")
  }, [view, setView])

  if (!user || user.profile.portal !== "internal") {
    return <InternalLogin onLogin={login} onChangePassword={changePassword} onExternal={onExternal} apiError={apiError} />
  }

  async function openWorkflowNotification(notification: WorkflowNotification) {
    void resolveNotification(notification)
    if (notification.targetType === "alert") {
      setSelectedAlertId(notification.targetId)
      setView(notification.route === "review" ? "allocation" : notification.route)
      return
    }
    if (notification.targetType === "case") {
      let targetCase = cases.find((caseRecord) => String(caseRecord.backendIntakeId) === String(notification.targetId) || caseRecord.id === notification.targetId)
      // A review notification can arrive while the allocated workspace still
      // holds the pre-review `Submitted` record. Load the authoritative intake
      // before navigating so approval immediately removes the workflow lock.
      if (/^\d+$/.test(String(notification.targetId))) {
        try {
          const latestIntake = await apiGet<IntakeRecord>(`/intakes/${notification.targetId}/`)
          const latestCase = caseFromIntake(latestIntake, alerts, districts)
          saveDraftCase(latestCase, { openIntake: false })
          targetCase = latestCase
        } catch {
          // Retain the already-loaded case as a navigation fallback if the
          // detail refresh is temporarily unavailable.
        }
      }
      if (targetCase) {
        // Allocation notifications created before the route was corrected may
        // still say `case-intake`.  Always take these notifications to the
        // allocated case lifecycle workspace where the SDO performs the work.
        const isAllocationNotification = notification.category === "Allocation" && notification.title === "Case allocated to you"
        if (notification.route === "case-intake" && !isAllocationNotification) {
          openFullIntake(targetCase)
          return
        }
        if (notification.route === "allocated-cases" || isAllocationNotification) {
          openAllocatedCase(targetCase)
          return
        }
      }
      setSelectedCaseId(targetCase?.id || notification.targetId)
    }
    setView(notification.route === "review" ? "allocation" : notification.route)
  }

  const isSystemAdmin = isAdminRole(user.profile.role)
  const isDistrictHead = user.profile.role === "DISTRICT_HEAD"
  const adminOnlyViews = new Set(["provinces", "districts", "relationship-types", "audit", "setup"])
  const approvalOnlyViews = new Set(["assessment-care-plan-approvals", "update-requests", "closure-approvals"])
  const currentView = (adminOnlyViews.has(view) && !isSystemAdmin) || (approvalOnlyViews.has(view) && !isDistrictHead) ? "dashboard" : view === "review" ? "allocation" : view

  function navigateInternal(nextView: string) {
    // Re-entering Case Intake from the sidebar must always start at its list,
    // rather than preserving the currently open intake workspace.
    if (nextView === "case-intake") setCaseIntakeNavigationKey((value) => value + 1)
    // The allocation menu entries always open their table, never a previously
    // opened case workspace.
    if (["allocation", "allocated-cases", "high-priority-cases"].includes(nextView)) setCaseQueueNavigationKey((value) => value + 1)
    setView(nextView)
  }

  return (
    <main className="h-screen overflow-hidden bg-[#eef2f5] text-[14px] text-[#5f7191]">
      <div className="h-6 bg-[#24384d]" />
      <div className="grid h-[calc(100vh-24px)] min-h-0 transition-[grid-template-columns] duration-200" style={{ gridTemplateColumns: sidebarCollapsed ? "72px minmax(0,1fr)" : "285px minmax(0,1fr)" }}>
        <InternalSideNav active={currentView === "report-history" ? "reports" : currentView} setActive={navigateInternal} user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
        <div className="flex min-h-0 min-w-0 flex-col">
          <InternalTopBar currentView={currentView} user={user} notifications={workflowNotifications} onOpenNotification={openWorkflowNotification} onViewAll={() => setView("notifications")} onLogout={logout} onProfile={() => setView("internal-profile")} />
          <section className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-4">
            {apiError && <ErrorBanner message={apiError} />}
            {view === "dashboard" && <InternalDashboard user={user} users={users} alerts={alerts} cases={cases} calendarTasks={calendarTasks} setSelectedAlertId={setSelectedAlertId} setSelectedCaseId={setSelectedCaseId} setView={setView} onOpenAllocatedCase={openAllocatedCase} onRefresh={refreshOperationalData} lastUpdatedAt={lastOperationalRefreshAt} />}
            {view === "notifications" && <Notifications notifications={workflowNotifications} onOpenNotification={openWorkflowNotification} />}
            {view === "case-alerts" && <AlertsInbox alerts={alerts} selectedId={selectedAlert.id} setSelectedAlertId={setSelectedAlertId} setView={setView} />}
            {view === "triage" && <Triage alert={selectedAlert} user={user} updateAlert={updateAlert} assessAlertValidity={assessAlertValidity} convertAlertToDraftCase={convertAlertToDraftCase} />}
            {view === "case-intake" && <CaseIntakeScreening key={caseIntakeNavigationKey} alert={selectedAlert} alerts={alerts} cases={cases} selectedCase={selectedCase} openCaseId={openIntakeCaseId} onOpenCaseHandled={clearOpenIntakeCaseId} onReturnToCaseWorkspace={openAllocatedCase} setSelectedAlertId={setSelectedAlertId} setView={setView} saveDraftCase={saveDraftCase} discardDraftCase={discardDraftCase} updateAlert={updateAlert} saveCalendarTasks={saveCalendarTasks} user={user} users={users} districts={districts} wards={wards} organizations={organizations} relationshipTypes={relationshipTypes} />}
            {["captured-cases", "new-intake", "intake", "screening"].includes(view) && <CaseIntakeScreening alert={selectedAlert} alerts={alerts} cases={cases} selectedCase={selectedCase} onReturnToCaseWorkspace={openAllocatedCase} setSelectedAlertId={setSelectedAlertId} setView={setView} saveDraftCase={saveDraftCase} discardDraftCase={discardDraftCase} updateAlert={updateAlert} saveCalendarTasks={saveCalendarTasks} user={user} users={users} districts={districts} wards={wards} organizations={organizations} relationshipTypes={relationshipTypes} />}
            {view === "review" && <DistrictHeadCaseQueue key={caseQueueNavigationKey} mode="unallocated" alerts={alerts} cases={cases} users={users} districts={districts} user={user} saveDraftCase={saveDraftCase} updateAlert={updateAlert} saveCalendarTasks={saveCalendarTasks} />}
            {view === "allocation" && <DistrictHeadCaseQueue key={caseQueueNavigationKey} mode="unallocated" alerts={alerts} cases={cases} users={users} districts={districts} user={user} saveDraftCase={saveDraftCase} updateAlert={updateAlert} saveCalendarTasks={saveCalendarTasks} />}
            {view === "attention" && <DistrictHeadCaseQueue key={caseQueueNavigationKey} mode="attention" alerts={alerts} cases={cases} users={users} districts={districts} user={user} saveDraftCase={saveDraftCase} updateAlert={updateAlert} saveCalendarTasks={saveCalendarTasks} />}
            {view === "high-priority-cases" && <DistrictHeadCaseQueue key={caseQueueNavigationKey} mode="priority" alerts={alerts} cases={cases} users={users} districts={districts} user={user} saveDraftCase={saveDraftCase} updateAlert={updateAlert} saveCalendarTasks={saveCalendarTasks} openFullIntake={openFullIntake} />}
            {view === "allocated-cases" && <DistrictHeadCaseQueue key={caseQueueNavigationKey} mode="allocated" alerts={alerts} cases={cases} users={users} districts={districts} user={user} saveDraftCase={saveDraftCase} updateAlert={updateAlert} saveCalendarTasks={saveCalendarTasks} openFullIntake={openFullIntake} openCaseId={openAllocatedCaseId} onOpenedCaseHandled={clearOpenAllocatedCaseId} />}
            {view === "reports" && <ReportsAnalytics mode="reports" user={user} alerts={alerts} cases={cases} users={users} districts={districts} provinces={provinces} onOpenHistory={() => setView("report-history")} />}
            {view === "report-history" && <ReportHistory onBack={() => setView("reports")} />}
            {view === "analytics" && <ReportsAnalytics mode="analytics" user={user} alerts={alerts} cases={cases} users={users} districts={districts} provinces={provinces} />}
            {view === "update-requests" && <UpdateRequestQueue user={user} onReviewed={async () => {
              const loadedAlerts = await refreshAlerts()
              await refreshIntakes(loadedAlerts)
              await refreshNotifications()
            }} />}
            {view === "assessment-care-plan-approvals" && isDistrictHead && <CaseApprovalQueue type="assessment-care-plan" cases={cases} user={user} onOpenCase={openAllocatedCase} onReviewed={refreshOperationalData} />}
            {view === "closure-approvals" && isDistrictHead && <CaseApprovalQueue type="closure" cases={cases} user={user} onOpenCase={openAllocatedCase} onReviewed={refreshOperationalData} />}
            {view === "audit" && isSystemAdmin && <Audit user={user} />}
            {view === "setup" && isSystemAdmin && <Setup users={users} organizations={organizations} provinces={provinces} districts={districts} wards={wards} refreshUsers={refreshUsers} refreshReferenceData={refreshReferenceData} />}
            {["provinces", "districts", "district-wards", "ccws", "partners-in-district", "register-courts", "relationship-types", "places"].includes(view) && (!adminOnlyViews.has(view) || isSystemAdmin) && <PartnerManagementSetup view={view} user={user} provinces={provinces} districts={districts} wards={wards} refreshReferenceData={refreshReferenceData} />}
            {view === "internal-profile" && <InternalProfile user={user} />}
            {adminOnlyViews.has(view) && !isSystemAdmin && <InternalDashboard user={user} users={users} alerts={alerts} cases={cases} calendarTasks={calendarTasks} setSelectedAlertId={setSelectedAlertId} setSelectedCaseId={setSelectedCaseId} setView={setView} onOpenAllocatedCase={openAllocatedCase} onRefresh={refreshOperationalData} lastUpdatedAt={lastOperationalRefreshAt} />}
            {approvalOnlyViews.has(view) && !isDistrictHead && <InternalDashboard user={user} users={users} alerts={alerts} cases={cases} calendarTasks={calendarTasks} setSelectedAlertId={setSelectedAlertId} setSelectedCaseId={setSelectedCaseId} setView={setView} onOpenAllocatedCase={openAllocatedCase} onRefresh={refreshOperationalData} lastUpdatedAt={lastOperationalRefreshAt} />}
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
          <h1 className="mt-3 text-[26px] font-extrabold text-[#10233f]">NCPMIS Public Portal</h1>
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
  const [signingIn, setSigningIn] = useState(false)

  async function submit() {
    if (signingIn) return
    setSigningIn(true)
    setError("")
    try {
      const result = await onLogin(username, password, "internal")
      if (isPasswordChangeRequired(result)) setMustChangePassword(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.")
    } finally {
      setSigningIn(false)
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
          <h1 className="mt-3 text-[26px] font-extrabold text-[#10233f]">Welcome to NCPMIS</h1>
          <p className="mt-1 text-sm font-semibold text-[#50617a]">{mustChangePassword ? "Set a private password to continue." : "Sign in to continue to the staff workspace."}</p>
        </div>
        <div className="space-y-4">
          {(error || apiError) && <ErrorBanner message={error || apiError} />}
          {!mustChangePassword ? (
            <>
              <Field label="Username or email"><input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
              <Field label="Password"><input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
              <button disabled={signingIn} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#008c7a] font-semibold text-white disabled:cursor-wait disabled:opacity-65" onClick={submit}>{signingIn ? <><RotateCcw className="h-4 w-4 animate-spin" /> Signing in…</> : <>Sign in <ArrowRight className="h-4 w-4" /></>}</button>
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

function Triage({ alert, user, updateAlert, assessAlertValidity, convertAlertToDraftCase }: { alert: AlertRecord; user: ApiUser; updateAlert: (id: string, changes: Partial<AlertRecord>) => void; assessAlertValidity: (alert: AlertRecord, isValid: boolean, reason?: string) => Promise<boolean>; convertAlertToDraftCase: (alert: AlertRecord) => void | Promise<void> }) {
  const [showAlertActions, setShowAlertActions] = useState(true)
  const [validity, setValidity] = useState<"yes" | "no" | "">(alert.validity_decision === "VALID" ? "yes" : alert.validity_decision === "INVALID" ? "no" : "")
  const [invalidReason, setInvalidReason] = useState(alert.invalid_reason || "")
  const [decisionError, setDecisionError] = useState("")
  const alertActionsLocked = ["Converted to Case", "Intake In Progress", "Pending Supervisor Review", "Approved for Allocation", "Allocated to Case Officer", "Rejected", "Closed - No Further Action", "Duplicate / Already Known", "Referred to Relevant Office"].includes(alert.status)
  const isSystemAdmin = user.profile.role === "SYS_ADMIN"

  async function submitValidityDecision() {
    if (!validity) {
      setDecisionError("Select whether this is a valid child protection alert.")
      return
    }
    if (validity === "no" && !invalidReason.trim()) {
      setDecisionError("Provide the reason for closing this alert.")
      return
    }
    setDecisionError("")
    await assessAlertValidity(alert, validity === "yes", invalidReason.trim())
  }

  return (
    <Panel title="Alert Details" icon={ShieldAlert} action={alert.id}>
      <div className={`grid gap-5 ${showAlertActions ? "xl:grid-cols-[minmax(0,1fr)_400px]" : ""}`}>
        <div className="space-y-4">
          <Summary
            alert={alert}
            action={!isSystemAdmin ? (
              <button className="grid h-8 w-8 place-items-center rounded-full border border-[#d8dee8] bg-white text-[#263747] shadow-sm hover:border-[#008c7a] hover:text-[#008c7a]" title="Alert action box" onClick={() => setShowAlertActions((value) => !value)}>
                <InfoIcon className="h-4 w-4" />
              </button>
            ) : undefined}
          />
          <AlertCapturedDetails alert={alert} />
        </div>
        {!isSystemAdmin && showAlertActions && (
          <aside className="h-fit rounded-md border border-[#d8dee8] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#edf0f4] px-5 py-4">
              <div><h3 className="text-lg font-bold text-[#263747]">Alert Validity</h3><div className="text-sm font-semibold text-[#64748b]">{alert.id}</div></div>
              <button className="grid h-9 w-9 place-items-center rounded-full border border-[#d8dee8]" onClick={() => setShowAlertActions(false)} title="Close alert action box">
                <InfoIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2 p-5">
              {alertActionsLocked ? (
                <div className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
                  <div className="text-sm font-bold text-[#263747]">Alert actions locked</div>
                  <p className="mt-1 text-sm leading-6 text-[#64748b]">
                    This alert is already {alert.status.toLowerCase()}. Continue the work from Case Intake.
                  </p>
                  {alert.validity_decision === "INVALID" && alert.invalid_reason && <p className="mt-3 text-sm font-semibold leading-6 text-[#50617a]">Reason: {alert.invalid_reason}</p>}
                  {alert.status === "Converted to Case" && (
                    <button className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={() => convertAlertToDraftCase(alert)}>
                      Open intake <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <p className="text-sm leading-6 text-[#64748b]">Review the alert details, then decide whether it is a valid child protection alert.</p>
                  <div className="space-y-3 rounded-md border border-[#d8dee8] bg-[#fbfdff] p-4">
                    <div className="font-bold text-[#263747]">Is this a valid child protection alert?</div>
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[#263747]"><input type="radio" name="alert-validity" checked={validity === "yes"} onChange={() => { setValidity("yes"); setDecisionError("") }} /> Yes</label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[#263747]"><input type="radio" name="alert-validity" checked={validity === "no"} onChange={() => { setValidity("no"); setDecisionError("") }} /> No</label>
                    {validity === "no" && <Field label="Reason if invalid"><textarea className={`${inputClass} min-h-[100px] py-3`} value={invalidReason} onChange={(event) => setInvalidReason(event.target.value)} placeholder="Explain why this alert is not a child protection case." /></Field>}
                    {decisionError && <div className="text-sm font-semibold text-[#b42318]">{decisionError}</div>}
                    {validity === "yes" && <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={submitValidityDecision}>Convert to Intake <ArrowRight className="h-4 w-4" /></button>}
                    {validity === "no" && <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#b42318] px-4 text-sm font-semibold text-white" onClick={submitValidityDecision}>Close Alert <X className="h-4 w-4" /></button>}
                  </div>
                  <div className="border-t border-[#edf0f4] pt-4">
                    <div className="mb-2 text-xs font-bold uppercase text-[#64748b]">Other triage actions</div>
                    <div className="space-y-2">
                      <ActionButton label="Request more information" onClick={() => updateAlert(alert.id, { status: "More Information Requested", internalStatus: "More Information Required" })} />
                      <ActionButton label="Mark duplicate" onClick={() => updateAlert(alert.id, { status: "Duplicate / Already Known", internalStatus: "Duplicate Review Required" })} />
                      <ActionButton label="Refer externally only" onClick={() => updateAlert(alert.id, { status: "Referred to Relevant Office", internalStatus: "Closed - Referred Externally" })} />
                      <ActionButton label="Escalate emergency" onClick={() => updateAlert(alert.id, { status: "Emergency Response Initiated", internalStatus: "Immediate Action Required", emergency: true, riskLevel: "Critical" })} />
                    </div>
                  </div>
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
                  <td className="border-b border-[#edf0f4] px-3 py-3">
                    <button className="grid h-9 w-9 place-items-center rounded-full border border-[#cbd5e1] bg-white text-[#008c7a] hover:border-[#008c7a] hover:bg-[#e7f6f3]" title="Open" onClick={() => setSelectedCaseId(caseRecord.id)}>
                      <Eye className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

type FamilyMemberDraft = {
  person_category: string
  relationship_to_child: string
  family_member_type: string
  guardian_type: string
  surname: string
  first_names: string
  name: string
  id_number: string
  dob_or_age: string
  date_of_birth: string
  estimated_age: string
  dob_entry_mode: string
  gender: string
  occupation: string
  employer: string
  address: string
  telephone: string
  number_of_wives: string
  order_of_wife: string
  living_involvement_status: string
  is_deceased_or_abandoned: string
  date_deceased: string
  date_abandoned: string
  remarks: string
}

type GuardianDraft = FamilyMemberDraft

type AllegedPerpetratorDraft = {
  id: string
  name: string
  relationship_to_child: string
  sex: string
  race: string
  referred_to_police: string
  police_referral_date: string
  court_appearance_scheduled: string
  court_appearance_date: string
  conviction_determined: string
  conviction_date: string
  circumstances_of_offence: string
}

function emptyAllegedPerpetrator(): AllegedPerpetratorDraft {
  return { id: "", name: "", relationship_to_child: "", sex: "", race: "", referred_to_police: "", police_referral_date: "", court_appearance_scheduled: "", court_appearance_date: "", conviction_determined: "", conviction_date: "", circumstances_of_offence: "" }
}

function emptyGuardianDraft(): GuardianDraft {
  return {
    person_category: "",
    relationship_to_child: "",
    family_member_type: "",
    guardian_type: "",
    surname: "",
    first_names: "",
    name: "",
    id_number: "",
    dob_or_age: "",
    date_of_birth: "",
    estimated_age: "",
    dob_entry_mode: "",
    gender: "",
    occupation: "",
    employer: "",
    address: "",
    telephone: "",
    number_of_wives: "",
    order_of_wife: "",
    living_involvement_status: "",
    is_deceased_or_abandoned: "",
    date_deceased: "",
    date_abandoned: "",
    remarks: "",
  }
}

const familyPersonCategories = ["Parent / Guardian", "Sibling", "Significant Other"]
const parentGuardianTypes = ["Father", "Mother", "Stepfather", "Stepmother", "Grandmother", "Grandfather", "Aunt", "Uncle", "Guardian", "Foster parent", "Relative caregiver", "Other"]
const siblingTypes = ["Brother", "Step brother", "Sister", "Step sister"]
const involvementStatuses = ["Deceased", "Abandoned"]

function showsWifeDetails(familyMemberType: string) {
  return ["father", "stepfather", "step father", "grandfather", "uncle", "relative caregiver", "guardian", "foster parent"].includes(familyMemberType.trim().toLowerCase())
}

function normalizeFamilyMemberDraft(value: Partial<GuardianDraft>): GuardianDraft {
  const cleanValue = { ...(value as Record<string, unknown>) }
  delete cleanValue.lives_with_child
  delete cleanValue.notes
  delete cleanValue.nature_of_support
  delete cleanValue.is_primary_caregiver
  if (cleanValue.person_category === "Significant Other") delete cleanValue.telephone
  if (cleanValue.living_involvement_status === "Abandoned child") cleanValue.living_involvement_status = "Abandoned"
  if (cleanValue.living_involvement_status && !involvementStatuses.includes(String(cleanValue.living_involvement_status))) cleanValue.living_involvement_status = ""
  const draft = { ...emptyGuardianDraft(), ...cleanValue } as GuardianDraft
  if (!draft.person_category) draft.person_category = "Parent / Guardian"
  if (!draft.family_member_type) draft.family_member_type = draft.guardian_type || ""
  if (!draft.guardian_type && draft.person_category === "Parent / Guardian") draft.guardian_type = draft.family_member_type
  if (!draft.name && draft.person_category !== "Parent / Guardian") draft.name = [draft.first_names, draft.surname].filter(Boolean).join(" ")
  if (draft.name && draft.person_category !== "Parent / Guardian" && !draft.first_names && !draft.surname) {
    const parts = draft.name.trim().split(/\s+/)
    draft.first_names = parts.length > 1 ? parts.slice(0, -1).join(" ") : draft.name
    draft.surname = parts.length > 1 ? parts.slice(-1).join(" ") : ""
  }
  if (!draft.estimated_age && /^\d+$/.test(draft.dob_or_age || "")) draft.estimated_age = draft.dob_or_age
  if (!draft.dob_entry_mode) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(draft.date_of_birth || "")) {
      draft.dob_entry_mode = "exact"
      draft.estimated_age = calculateAgeFromBirthDate(draft.date_of_birth)
      draft.dob_or_age = draft.estimated_age
    } else if (/^\d{4}-\d{2}$/.test(draft.date_of_birth || "") || draft.estimated_age) {
      draft.dob_entry_mode = "estimated"
    }
  }
  if (draft.dob_entry_mode === "estimated" && draft.estimated_age && !draft.date_of_birth) {
    draft.date_of_birth = estimatedBirthMonthFromAge(draft.estimated_age)
  }
  return draft
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
  onReturnToCaseWorkspace,
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
  relationshipTypes,
}: {
  alert: AlertRecord
  alerts: AlertRecord[]
  cases: CaseRecord[]
  selectedCase?: CaseRecord
  openCaseId?: string
  onOpenCaseHandled?: () => void
  onReturnToCaseWorkspace: (caseRecord: CaseRecord) => void
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
  relationshipTypes: RelationshipTypeOption[]
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
  const [activeTab, setActiveTab] = useState("officer")
  const [mode, setMode] = useState<"alert" | "manual">("alert")
  const [manualIntakeStartedAt, setManualIntakeStartedAt] = useState("")
  const [errors, setErrors] = useState<string[]>([])
  const [savedMessage, setSavedMessage] = useState("")
  const [requestTab, setRequestTab] = useState<IntakeUpdateTab | null>(null)
  const [requestReason, setRequestReason] = useState("")
  const [requestSnapshot, setRequestSnapshot] = useState<IntakeUpdateTab | null>(null)
  const [submissionDialog, setSubmissionDialog] = useState<{ caseId: string; detail: string } | null>(null)
  const [updateRequestDialog, setUpdateRequestDialog] = useState<{ title: string; detail: string } | null>(null)
  const [openCaseConcernSections, setOpenCaseConcernSections] = useState<string[]>([])
  const [showGuardianModal, setShowGuardianModal] = useState(false)
  const [editingGuardianIndex, setEditingGuardianIndex] = useState<number | null>(null)
  const [allegedPerpetrators, setAllegedPerpetrators] = useState<AllegedPerpetratorDraft[]>([])
  const [showAccusedModal, setShowAccusedModal] = useState(false)
  const [editingAccusedIndex, setEditingAccusedIndex] = useState<number | null>(null)
  const [accusedDraft, setAccusedDraft] = useState<AllegedPerpetratorDraft>(emptyAllegedPerpetrator)
  const [showPriorAssistanceModal, setShowPriorAssistanceModal] = useState(false)
  const [editingPreviousContact, setEditingPreviousContact] = useState<PreviousContactKey | null>(null)
  const [clockTick, setClockTick] = useState(Date.now())
  const [intakePage, setIntakePage] = useState(1)
  const [intakeRowsPerPage, setIntakeRowsPerPage] = useState(10)
  const [intakeEmergencyFilter, setIntakeEmergencyFilter] = useState<"All" | "Normal" | "Emergency" | "Immediate danger">("All")
  const defaultOfficer = officerDefaults(user)
  const [guardians, setGuardians] = useState<GuardianDraft[]>([])
  const [guardianDraft, setGuardianDraft] = useState<GuardianDraft>(emptyGuardianDraft)
  const [priorAssistanceDraft, setPriorAssistanceDraft] = useState<PreviousContacts>(emptyPreviousContacts)
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
    chief_name: "",
    nearest_landmark: "",
    capture_latitude: "",
    capture_longitude: "",
    concern_summary: "",
    reporter_narrative: "",
    emergency_reported: "",
    immediate_danger_reported: "",
    immediate_action_at: "",
    immediate_action_responsible: "",
    immediate_action_status: "",
    supervisor_notified: "",
    supervisor_notification_at: "",
    supervisor_notified_no_reason: "",
    child_moved_to_safety: "",
    referral_authority_contacted: "",
    emergency_change_reason: "",
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
    child_known: "",
    child_surname: "",
    child_first_names: "",
    child_id_number: "",
    child_sex: "",
    child_date_of_birth: "",
    child_age: "",
    birth_registered: "",
    disability_status: "",
    disability_description: "",
    child_address: "",
    referral_date: "",
    case_referred_by: "",
    reasons_for_intended_inquiry: "",
    child_contact_details: "",
    home_language: "",
    religion: "",
    child_race: "",
    selected_categories: [] as string[],
    juvenile_offences: [] as string[],
    juvenile_other_property_offence: "",
    alleged_perpetrator_known: "",
    accused_name: "",
    accused_relationship_to_child: "",
    accused_sex: "",
    accused_race: "",
    referred_to_police: "",
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
    immediate_danger: "",
    emergency_required: "",
    immediate_intervention_needed: "",
    immediate_response_actions: [] as string[],
    supervisor_notified_at: "",
    supervisor_notified_by: "",
    immediate_action_plan: "",
    risk_level: "",
    system_recommended_risk: "",
    risk_override_reason: "",
    vulnerability_factors: [] as string[],
    safety_concerns: "",
    screening_notes: "",
    previous_contacts: emptyPreviousContacts(),
    other_background_information: "",
    background_organisation: "",
    background_services: [] as string[],
    other_background_service: "",
    background_service_notes: "",
    caregiving_circumstances: "",
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
  const isHydratingIntake = useRef(false)
  const intakeTopRef = useRef<HTMLDivElement>(null)
  const intakeRecoveryKey = `ncms:intake-recovery:${form.intake_id || form.case_id || "new"}`

  useEffect(() => {
    if (!errors.length && !savedMessage) return
    const timeoutId = window.setTimeout(() => {
      setErrors([])
      setSavedMessage("")
    }, 10_000)
    return () => window.clearTimeout(timeoutId)
  }, [errors, savedMessage])

  const services = ["Medical assistance", "ART", "PEP", "Psycho-social support", "Legal assistance", "VFU services", "Emergency fund", "Cash transfer", "Drought relief", "Birth registration", "Home visit", "BEAM", "Educational assistance", "Transport voucher system", "Case follow ups", "Child Protection", "AMTO", "Case Conferencing / Family Casework", "Court Supervision", "Counselling", "Family Reunification", "Remove from street", "Education Assistance", "Health Assistance", "Financial Assistance", "Birth Registration Assistance", "Psychosocial / Mental Health Assistance", "Disability Assistance", "Bus Warrants", "Referral to Police", "Referral to Health Facility", "Temporary Place of Safety", "Other"]
  const institutionCategories = ["DSW", "Law Enforcement", "Court", "Agency", "Health Facility", "Other"]
  const institutionSuggestions = ["DSW", "Police VFU", "Juvenile Court", "Musasa", "Hospital", "School", "UNICEF", "Local authority"]
  const involvementTypesByCategory: Record<string, string[]> = {
    DSW: ["Child protection", "Family casework", "Alternative care", "Birth registration", "BEAM", "Family reunification", "Cash transfer", "Counselling", "Other"],
    "Law Enforcement": ["Victim", "Witness", "Conflict with law", "GBV", "Abuse report", "Trafficking", "Other"],
    Court: ["Protection order", "Custody", "Maintenance", "Probation", "Court supervision", "Alternative placement", "Other"],
    Agency: ["Case support", "Referral", "Education support", "Psychosocial support", "Protection support", "Other"],
    "Health Facility": ["Medical assessment", "Treatment", "ART", "PEP", "Mental health support", "Other"],
    Other: ["Support", "Referral", "Assessment", "Other"],
  }
  const juvenileOffenceGroups = [
    { title: "Offence against a person", options: ["Assault", "Sexual Offence", "Injustice"] },
    { title: "Offences against property", options: ["Malicious damage to property", "Theft", "Shoplifting", "Other property offence"] },
    { title: "Dangerous Drugs Act", options: ["Smoking / sniffing", "Drug trafficking"] },
    { title: "Other", options: ["Forgery, fraud and theft by conversion", "Offence against state and public order", "Wildlife Act"] },
  ]
  const previousInvolvementServiceGroups = [
    { title: "Protection", items: ["Case conferencing", "Family casework", "Child protection", "Court supervision", "Counselling", "Family reunification"] },
    { title: "Health", items: ["Medical", "ART", "PEP"] },
    { title: "Education", items: ["BEAM", "Educational assistance"] },
    { title: "Economic", items: ["Cash transfer", "Emergency support"] },
    { title: "Legal", items: ["Birth registration", "Legal support"] },
  ]
  const immediateResponseActionSections = [
    { title: "Safety / Protection", items: ["Temporary safety arrangement", "Emergency safety plan", "Shelter placement", "Temporary place of safety", "Remove child from danger", "Home visit / safety check"] },
    { title: "Health", items: ["Medical referral", "Emergency medical treatment", "PEP / ART referral", "Psychosocial first aid", "Counselling referral"] },
    { title: "Police / Legal", items: ["Police referral", "VFU referral", "Court order application", "Preserve evidence / medico-legal report"] },
    { title: "Basic Welfare / Access", items: ["Food assistance", "Transport assistance", "Clothing / hygiene support", "Disability support referral"] },
    { title: "Coordination", items: ["Partner referral", "Family tracing", "Caregiver contacted", "Follow-up visit scheduled", "Other urgent action"] },
  ]
  const immediateResponseActions = immediateResponseActionSections.flatMap((section) => section.items)
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
  const professionalRiskIndicators = ["perpetrator has access to child", "trafficking suspected", "disability", "child living on streets"]
  const tabs = [
    ["officer", "Officer & Informant"],
    ["child", "Child Details"],
    ["family", "Family Details"],
    ["case", "Case Type"],
    ["background", "Background Information"],
    ["screening", "Intake Summary"],
  ]
  const requiresProsecution = form.selected_categories.some((item) => ["Sexual abuse", "Physical abuse", "Sexual exploitation", "Child trafficking", "Child married before legal age", "Child in conflict with the law"].includes(item))
  const prosecutionOpen = requiresProsecution && openCaseConcernSections.includes("prosecution")
  const requiresJuvenileOffences = form.selected_categories.some((item) => ["Child in conflict with the law", "Child in contact with the law custody"].includes(item))
  const juvenileOffencesOpen = requiresJuvenileOffences && openCaseConcernSections.includes("juvenile-offences")

  useEffect(() => {
    setOpenCaseConcernSections((current) => {
      if (requiresProsecution) return current.includes("prosecution") ? current : [...current, "prosecution"]
      return current.filter((item) => item !== "prosecution")
    })
  }, [requiresProsecution])
  useEffect(() => {
    setOpenCaseConcernSections((current) => {
      if (requiresJuvenileOffences) return current.includes("juvenile-offences") ? current : [...current, "juvenile-offences"]
      return current.filter((item) => item !== "juvenile-offences")
    })
    if (!requiresJuvenileOffences) setForm((current) => ({ ...current, juvenile_offences: [], juvenile_other_property_offence: "" }))
  }, [requiresJuvenileOffences])
  const screeningClosed = ["PENDING_SUPERVISOR_REVIEW", "APPROVED_FOR_ALLOCATION", "ALLOCATED", "EMERGENCY_ESCALATED"].includes(form.status)
  const isAlertReferral = mode === "alert" || form.intake_source === "ALERT_REFERRAL" || form.intake_source === "ALERT"
  // A manual intake only becomes a real case once the officer and informant
  // details have been captured and the draft has been created.  Before then,
  // do not present it as an existing case with an active SLA or update flow.
  const isNewManualIntake = mode === "manual" && !form.intake_id
  const intakeSourceLabel = isAlertReferral ? "Alert Referral" : "Direct Intake"
  // `date_reported` is date-only and is interpreted as midnight. Preserve the
  // exact moment a manual intake starts so its 48-hour SLA begins at 48:00.
  const intakeSlaStartAt = mode === "manual" && manualIntakeStartedAt
    ? manualIntakeStartedAt
    : form.alert_received_at || selectedCase?.createdAt || form.date_reported || new Date().toISOString()
  const sla = screeningClosed
    ? calculateScreeningSla(intakeSlaStartAt, form.risk_level, form.status === "ALLOCATED" ? "Allocated" : form.status === "APPROVED_FOR_ALLOCATION" ? "Approved for Allocation" : form.status === "PENDING_SUPERVISOR_REVIEW" ? "Pending Supervisor Review" : "Submitted", clockTick, form.submitted_for_review_at || intakeSlaStartAt)
    : calculateSla(intakeSlaStartAt, form.risk_level, clockTick)
  const isSystemAdmin = user.profile.role === "SYS_ADMIN"
  const locked = isSystemAdmin || form.status !== "INTAKE_IN_PROGRESS"
  const editRequestMode = Boolean(requestTab)
  const fieldsLocked = isSystemAdmin || (locked && !editRequestMode)
  // Dependent child fields become available only after the officer confirms
  // that the child is known.  This prevents data entry while the selector is
  // still on its default “Select” state as well as for “No”.
  const childUnknown = form.child_known !== "Yes"
  const possibleMatchLabel = `${duplicateMatches.length} possible ${duplicateMatches.length === 1 ? "match" : "matches"} found`
  const detectedVulnerabilityFactors = [
    Number(form.child_age) > 0 && Number(form.child_age) < 5 ? "child under 5" : "",
    form.immediate_danger === "Yes" || form.immediate_danger_reported === "Yes" ? "child currently in danger" : "",
    form.selected_categories.some((item) => item.toLowerCase().includes("sexual")) ? "sexual abuse alleged" : "",
    form.selected_categories.some((item) => item.toLowerCase().includes("neglect")) ? "severe neglect" : "",
    form.selected_categories.some((item) => item.toLowerCase().includes("abandon")) || form.reporter_narrative.toLowerCase().includes("abandon") ? "child abandoned" : "",
    calculateSafeguardingClassification(form.selected_categories, form.immediate_danger === "Yes" || form.immediate_danger_reported === "Yes").isEmergency || form.immediate_response_actions.some((item) => item.toLowerCase().includes("medical")) ? "medical emergency" : "",
    duplicateMatches.length ? "repeat report" : "",
  ].filter(Boolean)
  const convertedFromAlert = mode === "alert" && Boolean(form.alert_id)
  const manualDeadlines = workflowDeadlines(form.alert_received_at || form.date_reported || selectedCase?.createdAt || alert.submittedAt, clockTick)
  const tabLabel = (tab: string) => tabs.find(([key]) => key === tab)?.[1] || "Officer & Informant"
  const currentCaseRecord = cases.find((caseRecord) => caseRecord.id === form.case_id) || selectedCase
  const canRequestUpdate = currentCaseRecord ? isCaseAllocatedToUser({ ...currentCaseRecord, deadline: "", deadlineStatus: "" }, user) : false
  const primaryCaseCategory = form.selected_categories[0] || ""
  const safeguardingState = calculateSafeguardingClassification(form.selected_categories, form.immediate_danger === "Yes" || form.immediate_danger_reported === "Yes")
  const emergencyState = { isEmergency: safeguardingState.isEmergency, isImmediateDanger: safeguardingState.isImmediateDanger }
  const showImmediateDangerFields = emergencyState.isImmediateDanger

  const intakeRows = cases
    .filter((caseRecord) => !isEmptyManualPlaceholder(caseRecord))
    .filter((caseRecord) => {
      if (intakeEmergencyFilter === "Normal") return !isEmergencyCaseRecord(caseRecord)
      if (intakeEmergencyFilter === "Emergency") return isEmergencyCaseRecord(caseRecord) && !isImmediateDangerCaseRecord(caseRecord)
      if (intakeEmergencyFilter === "Immediate danger") return isImmediateDangerCaseRecord(caseRecord)
      return true
    })
    .sort((first, second) => parseWorkflowDate(second.createdAt).getTime() - parseWorkflowDate(first.createdAt).getTime())
  const intakePageCount = Math.max(1, Math.ceil(intakeRows.length / intakeRowsPerPage))
  const safeIntakePage = Math.min(intakePage, intakePageCount)
  const intakePageRows = intakeRows.slice((safeIntakePage - 1) * intakeRowsPerPage, safeIntakePage * intakeRowsPerPage)
  const intakePageStart = intakeRows.length ? (safeIntakePage - 1) * intakeRowsPerPage + 1 : 0
  const intakePageEnd = Math.min(intakeRows.length, safeIntakePage * intakeRowsPerPage)

  useEffect(() => {
    const intervalId = window.setInterval(() => setClockTick(Date.now()), 60000)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => setIntakePage(1), [intakeRows.length, intakeRowsPerPage, intakeEmergencyFilter])

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
    if (activeTab === "case") setOpenCaseConcernSections([])
  }, [activeTab])

  useEffect(() => {
    if (workspace !== "form" || locked || editRequestMode) return
    const duplicateFields = [
      form.child_first_names,
      form.child_surname,
      form.child_date_of_birth,
      form.child_age,
      form.child_contact_details,
      form.informant_phone,
      form.district,
      form.ward,
      primaryCaseCategory,
      guardians.map((guardian) => `${guardian.first_names} ${guardian.surname} ${guardian.telephone} ${guardian.address}`).join("|"),
      `${guardianDraft.name} ${guardianDraft.first_names} ${guardianDraft.surname} ${guardianDraft.telephone} ${guardianDraft.address}`,
    ].join("|").trim()
    if (!duplicateFields) return
    const timeoutId = window.setTimeout(() => runDuplicateCheck(false), 350)
    return () => window.clearTimeout(timeoutId)
  }, [
    workspace,
    locked,
    editRequestMode,
    form.child_first_names,
    form.child_surname,
    form.child_date_of_birth,
    form.child_age,
    form.child_contact_details,
    form.informant_phone,
    form.district,
    form.ward,
    primaryCaseCategory,
    guardians,
    guardianDraft.first_names,
    guardianDraft.name,
    guardianDraft.surname,
    guardianDraft.telephone,
    guardianDraft.address,
    cases,
  ])

  useEffect(() => {
    if (isHydratingIntake.current || workspace !== "form" || locked || editRequestMode || !form.intake_id) return
    const payload = JSON.stringify(autosavePayload())
    if (payload === lastAutosavePayload.current) return
    setAutosaveState("dirty")
    const timeoutId = window.setTimeout(() => {
      void autosaveDraft()
    }, 2000)
    return () => window.clearTimeout(timeoutId)
  }, [workspace, locked, editRequestMode, form, guardians, guardianDraft, allegedPerpetrators])

  useEffect(() => {
    if (isHydratingIntake.current || workspace !== "form" || locked || editRequestMode || !form.intake_id) return
    const intervalId = window.setInterval(() => {
      void autosaveDraft()
    }, 45000)
    return () => window.clearInterval(intervalId)
  }, [workspace, locked, editRequestMode, form.intake_id])

  useEffect(() => {
    if (workspace !== "form" || locked || editRequestMode) return
    try {
      window.localStorage.setItem(intakeRecoveryKey, JSON.stringify({ form, guardians, guardianDraft, allegedPerpetrators, activeTab, savedAt: new Date().toISOString() }))
    } catch {}
  }, [workspace, locked, editRequestMode, intakeRecoveryKey, form, guardians, guardianDraft, allegedPerpetrators, activeTab])

  useEffect(() => {
    if (workspace !== "form" || locked || editRequestMode || activeTab !== "screening") return
    runDuplicateCheck(false)
    calculateRisk(false)
  }, [
    workspace,
    locked,
    editRequestMode,
    activeTab,
    form.child_first_names,
    form.child_surname,
    form.child_date_of_birth,
    form.child_age,
    form.child_contact_details,
    form.informant_phone,
    form.district,
    form.ward,
    primaryCaseCategory,
    form.selected_categories,
    form.vulnerability_factors,
    form.emergency_required,
    form.immediate_danger,
    guardians,
    allegedPerpetrators,
  ])

  function setValue(key: string, value: string | string[]) {
    if (fieldsLocked) return
    setForm((current) => {
      if (key === "child_known" && value === "No") {
        return {
          ...current,
          child_known: "No",
          child_surname: "",
          child_first_names: "",
          child_id_number: "",
          child_sex: "",
          child_date_of_birth: "",
          child_age: "",
          child_contact_details: "",
          child_address: "",
          birth_registered: "",
          disability_status: "",
          disability_description: "",
          home_language: "",
          religion: "",
          child_race: "",
        }
      }
      if (key === "child_date_of_birth" && typeof value === "string") {
        return { ...current, child_date_of_birth: value, child_age: calculateAgeFromBirthDate(value) }
      }
      if (key === "child_age" && typeof value === "string") {
        const cleanAge = value.replace(/[^\d]/g, "").slice(0, 3)
        return { ...current, child_age: cleanAge }
      }
      if (key === "disability_status" && typeof value === "string" && value !== "Yes") {
        return { ...current, disability_status: value, disability_description: "" }
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
      if (key === "alleged_perpetrator_known" && typeof value === "string" && value !== "Yes") {
        return { ...current, alleged_perpetrator_known: value, accused_name: "", accused_relationship_to_child: "", accused_sex: "", accused_race: "" }
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

  function toggleCaseConcernSection(section: string) {
    setOpenCaseConcernSections((current) => (current.includes(section) ? current.filter((item) => item !== section) : [...current, section]))
  }

  function selectedCaseConcernCount(items: string[]) {
    return items.filter((item) => form.selected_categories.includes(item)).length
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

  async function setTab(tab: string) {
    if (editRequestMode) {
      setSavedMessage("Finish or cancel the current update request before changing tabs.")
      return
    }
    const currentIndex = tabs.findIndex(([key]) => key === activeTab)
    const nextIndex = tabs.findIndex(([key]) => key === tab)
    let tabCaseId = form.case_id
    if (mode === "manual" && workspace === "form" && !form.intake_id && activeTab === "child" && nextIndex > currentIndex) {
      const createdCaseId = await createManualDraftAfterChildDetails(tab)
      if (!createdCaseId) return
      tabCaseId = createdCaseId
    }
    if (!locked) {
      if (form.intake_id) void autosaveDraft("tab", tab)
      runDuplicateCheck(false)
      calculateRisk(false)
    }
    setLastTabs((items) => {
      const next = { ...items, [tabCaseId]: tab }
      window.localStorage.setItem(lastTabsStorageKey, JSON.stringify(next))
      return next
    })
    setActiveTab(tab)
    window.requestAnimationFrame(() => {
      intakeTopRef.current?.scrollIntoView({ block: "start" })
      window.scrollTo({ top: 0 })
    })
  }

  async function openCaseIntake(caseRecord: CaseRecord, options: { updateGuidance?: boolean; ignoreLocalRecovery?: boolean } = {}) {
    isHydratingIntake.current = true
    const savedIntake = caseRecord.backendIntakeId
      ? await apiGet<IntakeRecord>(`/intakes/${caseRecord.backendIntakeId}/`).catch(() => null)
      : null
    let localRecovery: { form?: Partial<typeof form>; guardians?: GuardianDraft[]; guardianDraft?: GuardianDraft; allegedPerpetrators?: AllegedPerpetratorDraft[]; activeTab?: string } | null = null
    // A successful API response is authoritative. Browser recovery is used only
    // when the server record cannot be loaded, preventing stale/empty local data
    // from overwriting a valid database draft after a deployment or refresh.
    if (!savedIntake && !options.ignoreLocalRecovery) {
      try {
        const recoveryKey = `ncms:intake-recovery:${caseRecord.backendIntakeId || caseRecord.id}`
        localRecovery = JSON.parse(window.localStorage.getItem(recoveryKey) || "null")
      } catch {}
    }
    const sourceAlert = caseRecord.sourceAlertId ? alerts.find((item) => item.id === caseRecord.sourceAlertId) || alert : undefined
    const opening = savedIntake?.opening_summary || {}
    const savedInformant = objectValue(opening.informant)
    const savedScreening = objectValue(opening.screening_draft)
    const recordedCreator = savedIntake?.createdBy
    const childDraft = savedIntake?.child_profile_draft || {}
    const householdDraft = savedIntake?.household_profile_draft || {}
    const savedGuardians = Array.isArray(householdDraft.family_members)
      ? (householdDraft.family_members as GuardianDraft[]).map((item) => normalizeFamilyMemberDraft(item))
      : Array.isArray(householdDraft.guardians)
        ? (householdDraft.guardians as GuardianDraft[]).map((item) => ({
            ...normalizeFamilyMemberDraft(item),
            living_involvement_status: item.living_involvement_status || (item.is_deceased_or_abandoned === "Yes" ? "Deceased" : ""),
          }))
        : []
    const isAlertCase = Boolean(caseRecord.sourceAlertId)
    const referralAt = textValue(opening.alert_referred_at) || savedIntake?.created_at || caseRecord.createdAt
    const sourceNameParts = (sourceAlert?.information_source_name || "").trim().split(/\s+/)
    const sourceSurname = sourceAlert?.information_source_surname || (sourceNameParts.length > 1 ? sourceNameParts.slice(-1).join(" ") : "")
    const sourceFirstNames = sourceAlert?.information_source_first_names || (sourceNameParts.length > 1 ? sourceNameParts.slice(0, -1).join(" ") : sourceAlert?.information_source_name || "")
    const authoritativeCaseStatus = savedIntake?.status ? caseStatusFromIntake(savedIntake.status) : caseRecord.status
    const lifecycleStatus =
      authoritativeCaseStatus === "Allocated"
        ? "ALLOCATED"
        : authoritativeCaseStatus === "Approved for Allocation"
          ? "APPROVED_FOR_ALLOCATION"
          : authoritativeCaseStatus === "Pending Supervisor Review"
            ? "PENDING_SUPERVISOR_REVIEW"
            : authoritativeCaseStatus === "Submitted"
              ? "EMERGENCY_ESCALATED"
              : "INTAKE_IN_PROGRESS"
    // Browser recovery is for interrupted draft capture only; it must not
    // replace the approved/allocated case state after an update request.
    if (lifecycleStatus !== "INTAKE_IN_PROGRESS") localRecovery = null
    if (savedIntake) {
      saveDraftCase({ ...caseRecord, status: authoritativeCaseStatus }, { openIntake: false })
    }
    const submittedAt = textValue(savedScreening.submitted_for_review_at) || caseRecord.submittedForReviewAt || caseRecord.screeningCompletedAt || savedIntake?.screening_completed_at || ""
    if (caseRecord.sourceAlertId) setSelectedAlertId(caseRecord.sourceAlertId)
    const backgroundInformation = savedIntake?.background_information || caseRecord.background_information || {}
    setMode(isAlertCase ? "alert" : "manual")
    setManualIntakeStartedAt(isAlertCase ? "" : textValue(opening.autosave_started_at) || savedIntake?.created_at || caseRecord.createdAt)
    lastAutosavePayload.current = ""
    setAutosaveState(lifecycleStatus === "INTAKE_IN_PROGRESS" ? "saved" : "idle")
    setAutosavedAt("")
    setForm((current) => ({
      ...current,
      intake_id: caseRecord.backendIntakeId || null,
      alert_id: caseRecord.sourceAlertId || "",
      case_id: caseRecord.id,
      intake_number: `INT-${caseRecord.id.replace("CASE-", "")}`,
      intake_source: isAlertCase ? "ALERT_REFERRAL" : "DIRECT_INTAKE",
      status: lifecycleStatus,
      alert_received_at: isAlertCase ? referralAt : "",
      date_reported: textValue(opening.date_reported) || dateInputValue(isAlertCase ? sourceAlert?.submittedAt || referralAt : caseRecord.createdAt),
      reporting_channel: textValue(opening.reporting_channel) || sourceAlert?.reporting_channel || sourceAlert?.reporterType || current.reporting_channel,
      district: textValue(childDraft.district) || textValue(opening.district) || caseRecord.district,
      ward: textValue(childDraft.ward) || textValue(opening.ward) || caseRecord.ward,
      village: textValue(childDraft.village) || textValue(opening.village) || sourceAlert?.village_suburb || "",
      chief_name: textValue(childDraft.chief_name) || textValue(opening.chief_name) || sourceAlert?.chief_name || "",
      nearest_landmark: textValue(childDraft.nearest_landmark) || textValue(opening.nearest_landmark) || sourceAlert?.nearest_landmark || "",
      capture_latitude: textValue(childDraft.capture_latitude) || textValue(childDraft.latitude),
      capture_longitude: textValue(childDraft.capture_longitude) || textValue(childDraft.longitude),
      concern_summary: textValue(opening.concern_summary) || caseRecord.concern,
      reporter_narrative: textValue(opening.reporter_narrative) || caseRecord.description,
      emergency_reported: textValue(opening.emergency_reported) || (sourceAlert?.emergency ? "Yes" : "No"),
      immediate_danger_reported: textValue(opening.immediate_danger_reported) || (savedIntake?.is_immediate_danger || sourceAlert?.danger.length ? "Yes" : "No"),
      immediate_action_at: textValue(savedIntake?.immediate_action_at) || textValue(savedScreening.immediate_action_at),
      immediate_action_responsible: textValue(savedIntake?.immediate_action_responsible) || textValue(savedScreening.immediate_action_responsible),
      immediate_action_status: textValue(savedIntake?.immediate_action_status) || textValue(savedScreening.immediate_action_status),
      supervisor_notified: textValue(savedIntake?.supervisor_notified) || textValue(savedScreening.supervisor_notified),
      supervisor_notification_at: textValue(savedIntake?.supervisor_notification_at) || textValue(savedScreening.supervisor_notification_at),
      supervisor_notified_no_reason: textValue(savedIntake?.supervisor_notified_no_reason) || textValue(savedScreening.supervisor_notified_no_reason),
      child_moved_to_safety: textValue(savedIntake?.child_moved_to_safety) || textValue(savedScreening.child_moved_to_safety),
      referral_authority_contacted: textValue(savedIntake?.referral_authority_contacted) || textValue(savedScreening.referral_authority_contacted),
      emergency_change_reason: textValue(savedIntake?.emergency_change_reason),
      // For an existing intake, attribution must come from the saved record or
      // its immutable created_by account—never from the national user viewing it.
      officer_user_id: textValue(opening.officer_user_id) || recordedCreator?.officerCode || (savedIntake ? "Not recorded" : defaultOfficer.officer_user_id),
      officer_surname: textValue(opening.officer_surname) || recordedCreator?.lastName || (savedIntake ? "Not recorded" : defaultOfficer.officer_surname),
      officer_first_names: textValue(opening.officer_first_names) || recordedCreator?.firstName || recordedCreator?.username || (savedIntake ? "Not recorded" : defaultOfficer.officer_first_names),
      officer_designation: textValue(opening.officer_designation) || recordedCreator?.roleLabel || (savedIntake ? "Not recorded" : defaultOfficer.officer_designation),
      officer_district: textValue(opening.officer_district) || recordedCreator?.districtName || (savedIntake ? "Not recorded" : defaultOfficer.officer_district),
      officer_contact: textValue(opening.officer_contact) || recordedCreator?.phone || recordedCreator?.email || (savedIntake ? "Not recorded" : defaultOfficer.officer_contact),
      informant_surname: textValue(savedInformant.surname) || sourceSurname,
      informant_first_names: textValue(savedInformant.first_names) || sourceFirstNames,
      informant_id_number: textValue(savedInformant.id_number) || sourceAlert?.information_source_id_number || "",
      informant_sex: textValue(savedInformant.sex) || sourceAlert?.information_source_sex || "",
      informant_address: textValue(savedInformant.address) || sourceAlert?.information_source_address || "",
      informant_relationship_to_child: textValue(savedInformant.relationship_to_child) || sourceAlert?.information_source_relationship_to_child || sourceAlert?.relationship_to_child || "",
      informant_phone: textValue(savedInformant.phone) || sourceAlert?.information_source_contact || "",
      informant_email: textValue(savedInformant.email) || sourceAlert?.information_source_email || "",
      informant_organization: textValue(savedInformant.organization) || sourceAlert?.information_source_type || "",
      child_known: textValue(childDraft.known) || (caseRecord.childName.toLowerCase().includes("unknown") ? "No" : "Yes"),
      child_surname: textValue(childDraft.surname) || sourceAlert?.child_surname || caseRecord.childName.split(" ").slice(-1)[0] || "",
      child_first_names: textValue(childDraft.first_names) || sourceAlert?.child_first_name || caseRecord.childName.split(" ").slice(0, -1).join(" ") || caseRecord.childName,
      child_id_number: textValue(childDraft.id_number),
      child_sex: textValue(childDraft.sex) || (caseRecord.sex.toUpperCase() === "FEMALE" || caseRecord.sex.toUpperCase() === "MALE" ? caseRecord.sex.toUpperCase() : "UNKNOWN"),
      child_date_of_birth: textValue(childDraft.date_of_birth),
      child_age: textValue(childDraft.age) || caseRecord.age,
      birth_registered: textValue(childDraft.birth_registered) || sourceAlert?.birth_registered || "",
      disability_status: textValue(childDraft.disability_status) || sourceAlert?.disability || "",
      disability_description: textValue(childDraft.disability_description),
      child_address: textValue(childDraft.address_of_child) || textValue(childDraft.address) || sourceAlert?.home_address || "",
      referral_date: dateInputValue(savedIntake?.referral_date || ""),
      case_referred_by: textValue(savedIntake?.case_referred_by),
      reasons_for_intended_inquiry: textValue(childDraft.reasons_for_intended_inquiry),
      child_contact_details: textValue(childDraft.contact_details),
      home_language: textValue(childDraft.home_language),
      religion: textValue(childDraft.religion),
      child_race: textValue(childDraft.race),
      selected_categories: arrayValue(savedScreening.selected_categories).length ? arrayValue(savedScreening.selected_categories) : sourceAlert && alertConcerns(sourceAlert).length ? alertConcerns(sourceAlert) : caseRecord.concern ? [caseRecord.concern] : [],
      juvenile_offences: arrayValue(savedScreening.juvenile_offences),
      juvenile_other_property_offence: textValue(savedScreening.juvenile_other_property_offence),
      alleged_perpetrator_known: textValue(savedScreening.alleged_perpetrator_known) || sourceAlert?.alleged_perpetrator_known || "",
      accused_name: textValue(savedScreening.accused_name) || sourceAlert?.alleged_perpetrator_name || "",
      accused_relationship_to_child: textValue(savedScreening.accused_relationship_to_child) || sourceAlert?.alleged_perpetrator_relationship || "",
      accused_sex: textValue(savedScreening.accused_sex) || sourceAlert?.alleged_perpetrator_sex || "",
      accused_race: textValue(savedScreening.accused_race) || sourceAlert?.alleged_perpetrator_race || "",
      referred_to_police: textValue(savedScreening.referred_to_police) || sourceAlert?.referred_to_police || "",
      police_referral_date: textValue(savedScreening.police_referral_date) || sourceAlert?.police_referral_date || "",
      court_appearance_scheduled: textValue(savedScreening.court_appearance_scheduled) || sourceAlert?.court_appearance_scheduled || "",
      court_appearance_date: textValue(savedScreening.court_appearance_date) || sourceAlert?.court_appearance_date || "",
      conviction_determined: textValue(savedScreening.conviction_determined) || sourceAlert?.conviction_determined || "",
      conviction_date: textValue(savedScreening.conviction_date) || sourceAlert?.conviction_date || "",
      circumstances_of_offence: textValue(savedScreening.circumstances_of_offence),
      duplicate_status: textValue(savedScreening.duplicate_status) || "NOT_CHECKED",
      duplicate_decision: textValue(savedScreening.duplicate_decision),
      linked_case_id: textValue(savedScreening.linked_case_id),
      duplicate_notes: textValue(savedScreening.duplicate_notes),
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
      background_service_notes: textValue(backgroundInformation.background_service_notes) || textValue(savedScreening.background_service_notes),
      previous_contacts: normalizePreviousContacts(backgroundInformation.previous_contacts),
      caregiving_circumstances: textValue(householdDraft.caregiving_circumstances) || textValue(backgroundInformation.caregiving_circumstances),
      other_background_information: textValue(backgroundInformation.other_background_information),
      child_story_or_reported_circumstances: textValue(backgroundInformation.child_story_or_reported_circumstances),
      screening_outcome: textValue(savedScreening.screening_outcome),
      closure_reason: textValue(savedScreening.closure_reason),
      submission_comments: textValue(savedScreening.submission_comments),
      submitted_for_review_at: submittedAt,
      ...(localRecovery?.form || {}),
    }))
    setGuardians((localRecovery?.guardians || savedGuardians).map((item) => normalizeFamilyMemberDraft(item)))
    const savedAccused = Array.isArray(savedIntake?.alleged_perpetrators) ? savedIntake.alleged_perpetrators : []
    const legacyAccusedName = textValue(savedScreening.accused_name) || sourceAlert?.alleged_perpetrator_name || ""
    setAllegedPerpetrators(localRecovery?.allegedPerpetrators?.length ? localRecovery.allegedPerpetrators.map((item) => ({ ...emptyAllegedPerpetrator(), ...item })) : savedAccused.length ? savedAccused.map((item) => ({ ...emptyAllegedPerpetrator(), ...item })) : legacyAccusedName ? [{
      ...emptyAllegedPerpetrator(), id: `legacy-${caseRecord.backendIntakeId || caseRecord.id}`, name: legacyAccusedName,
      relationship_to_child: textValue(savedScreening.accused_relationship_to_child) || sourceAlert?.alleged_perpetrator_relationship || "",
      sex: textValue(savedScreening.accused_sex) || sourceAlert?.alleged_perpetrator_sex || "", race: textValue(savedScreening.accused_race) || sourceAlert?.alleged_perpetrator_race || "",
      referred_to_police: textValue(savedScreening.referred_to_police), police_referral_date: textValue(savedScreening.police_referral_date),
      court_appearance_scheduled: textValue(savedScreening.court_appearance_scheduled), court_appearance_date: textValue(savedScreening.court_appearance_date),
      conviction_determined: textValue(savedScreening.conviction_determined), conviction_date: textValue(savedScreening.conviction_date), circumstances_of_offence: textValue(savedScreening.circumstances_of_offence),
    }] : [])
    setGuardianDraft(normalizeFamilyMemberDraft(localRecovery?.guardianDraft || { ...objectValue(householdDraft.draft_guardian), ...objectValue(householdDraft.draft_family_member) }))
    if (!textValue(childDraft.capture_latitude) && !textValue(childDraft.capture_longitude) && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => setForm((current) => ({ ...current, capture_latitude: position.coords.latitude.toFixed(6), capture_longitude: position.coords.longitude.toFixed(6) })),
        () => undefined,
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      )
    }
    const savedLastTab = textValue(opening.last_active_tab)
    const restoredTab = tabs.some(([key]) => key === savedLastTab) ? savedLastTab : lastTabs[caseRecord.id] || "officer"
    setActiveTab(localRecovery?.activeTab && tabs.some(([key]) => key === localRecovery?.activeTab) ? localRecovery.activeTab : restoredTab)
    setWorkspace("form")
    setErrors([])
    setSavedMessage(localRecovery ? "Recovered your most recent local draft changes." : lifecycleStatus === "INTAKE_IN_PROGRESS" ? (restoredTab === "officer" ? "" : `Please continue where you left off: ${tabLabel(restoredTab)}.`) : "")
    window.requestAnimationFrame(() => {
      isHydratingIntake.current = false
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
      if (Array.isArray(input)) return input.length ? (input.some((item) => typeof item === "object") ? JSON.stringify(input) : input.join(", ")) : "Not captured"
      const text = `${input ?? ""}`.trim()
      return text || "Not captured"
    }
    const guardianSummary = guardians.length
      ? guardians.map((item) => [item.person_category, familyMemberName(item), item.telephone].filter(Boolean).join(" ")).join("; ")
      : "No family member captured"
    const tabFields: Record<string, [string, string, unknown][]> = {
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
        ["child_profile_draft.district", "District", form.district],
        ["child_profile_draft.ward", "Ward", form.ward],
        ["child_profile_draft.village", "Village", form.village],
        ["child_profile_draft.chief_name", "Chief name", form.chief_name],
        ["child_profile_draft.nearest_landmark", "Nearest landmark", form.nearest_landmark],
        ["child_profile_draft.known", "Child known", form.child_known],
        ["child_profile_draft.surname", "Surname", form.child_surname],
        ["child_profile_draft.first_names", "First names", form.child_first_names],
        ["child_profile_draft.sex", "Sex", form.child_sex],
        ["child_profile_draft.date_of_birth", "Date of birth", form.child_date_of_birth],
        ["child_profile_draft.age", "Age", form.child_age],
        ["child_profile_draft.home_language", "Home language", form.home_language],
        ["child_profile_draft.religion", "Religion", form.religion],
        ["child_profile_draft.race", "Race", form.child_race],
        ["child_profile_draft.address_of_child", "Address of Child", form.child_address],
        ["referral_date", "Date of referral", form.referral_date],
        ["case_referred_by", "Case referred by", form.case_referred_by],
        ["child_profile_draft.reasons_for_intended_inquiry", "Reasons for intended inquiry", form.reasons_for_intended_inquiry],
      ],
      family: [
        ["household_profile_draft.family_members", "Family member records", guardianSummary],
        ["household_profile_draft.draft_family_member", "Current family member draft", [guardianDraft.person_category, familyMemberName(guardianDraft), guardianDraft.telephone].filter(Boolean).join(" ")],
        ["household_profile_draft.caregiving_circumstances", "Caregiving circumstances", form.caregiving_circumstances],
      ],
      case: [
        ["opening_summary.screening_draft.selected_categories", "Case categories", form.selected_categories],
        ["opening_summary.screening_draft.juvenile_offences", "Juvenile delinquency offences", form.juvenile_offences],
        ["opening_summary.screening_draft.juvenile_other_property_offence", "Other property offence", form.juvenile_other_property_offence],
        ["opening_summary.screening_draft.alleged_perpetrator_known", "Perpetrator known", form.alleged_perpetrator_known],
        ["alleged_perpetrators", "Alleged perpetrator records", allegedPerpetrators],
      ],
      background: [
        ["background_information.previous_contacts", "Previous contacts", previousContactDefinitions.map(({ key, label }) => `${label}: ${form.previous_contacts[key].has_contact || "Not captured"}${form.previous_contacts[key].reason ? ` - ${form.previous_contacts[key].reason}` : ""}`).join("\n")],
        ["background_information.child_story_or_reported_circumstances", "Other Background Information", form.child_story_or_reported_circumstances],
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
      fields: (tabFields[activeTab] || tabFields.officer).map(([path, label, current_value]) => ({ path, label, current_value: value(current_value) })),
    }
  }

  function startUpdateRequestMode() {
    const tab = activeUpdateTab()
    setRequestTab(tab)
    setRequestSnapshot(tab)
    setRequestReason("")
    setSavedMessage("")
    setErrors([])
    window.requestAnimationFrame(() => intakeTopRef.current?.scrollIntoView({ block: "start" }))
  }

  function detectedUpdateChanges() {
    if (!requestSnapshot) return []
    const latest = activeUpdateTab()
    return requestSnapshot.fields.reduce<IntakeUpdateField[]>((changes, original) => {
      const updated = latest.fields.find((field) => field.path === original.path)
      if (!updated || updated.current_value === original.current_value) return changes
      changes.push({
        ...original,
        tab_name: requestSnapshot.label,
        section_name: requestSnapshot.label,
        old_value: original.current_value,
        new_value: updated.current_value,
        proposed_value: updated.current_value,
      })
      return changes
    }, [])
  }

  async function exitUpdateRequestMode(resetForm = true) {
    setRequestTab(null)
    setRequestSnapshot(null)
    setRequestReason("")
    if (resetForm && currentCaseRecord) {
      await openCaseIntake(currentCaseRecord, { ignoreLocalRecovery: true })
      setActiveTab(activeTab)
    }
  }

  async function submitUpdateRequest() {
    const changes = detectedUpdateChanges()
    if (!form.intake_id || !requestTab || !requestReason.trim()) {
      setErrors(["Enter a reason for the requested update."])
      return
    }
    if (!changes.length) {
      setErrors(["No changed fields detected on this tab. Update at least one field before submitting."])
      return
    }
    const submittedTab = requestTab.label
    await apiPost("/update-requests/", { intake: form.intake_id, tab: submittedTab, requested_fields: changes, reason: requestReason.trim() })
    await exitUpdateRequestMode(true)
    setUpdateRequestDialog({
      title: "Update Request Submitted",
      detail: `Your update request for ${submittedTab} has been sent for supervisor approval. The case will not change until it is approved.`,
    })
  }

  function editTabButton() {
    // Update requests are for an assigned, locked intake only.  In
    // particular, they must not leak through from a previously selected case
    // while a new manual intake is being captured.
    if (!form.intake_id || !locked || !canRequestUpdate) return null
    return (
      <button
        type="button"
        className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d8dee8] bg-white px-3 text-xs font-bold uppercase text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]"
        title="Request update for this tab"
        onClick={startUpdateRequestMode}
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

  function addPriorAssistance() {
    setEditingPreviousContact(null)
    setPriorAssistanceDraft(normalizePreviousContacts(form.previous_contacts))
    setShowPriorAssistanceModal(true)
  }

  function editPriorAssistance(key: PreviousContactKey) {
    setEditingPreviousContact(key)
    setPriorAssistanceDraft(normalizePreviousContacts(form.previous_contacts))
    setShowPriorAssistanceModal(true)
  }

  function updatePreviousContactDraft(key: PreviousContactKey, field: keyof PreviousContact, value: string) {
    setPriorAssistanceDraft((current) => ({ ...current, [key]: { ...current[key], [field]: value, ...(field === "has_contact" && value !== "Yes" ? { reason: "" } : {}) } }))
  }

  function closePriorAssistanceModal() {
    setShowPriorAssistanceModal(false)
    setEditingPreviousContact(null)
    setPriorAssistanceDraft(emptyPreviousContacts())
  }

  function savePriorAssistance() {
    const keys = editingPreviousContact ? [editingPreviousContact] : previousContactDefinitions.map((item) => item.key)
    const missingReason = keys.some((key) => priorAssistanceDraft[key].has_contact === "Yes" && !priorAssistanceDraft[key].reason.trim())
    if (missingReason) {
      setErrors(["Provide a reason for each previous contact marked Yes."])
      return
    }
    setForm((current) => ({ ...current, previous_contacts: priorAssistanceDraft }))
    setErrors([])
    closePriorAssistanceModal()
    setSavedMessage(editingPreviousContact ? "Previous contact updated." : "Previous contacts saved.")
  }

  function manualDraftHasCapturedData() {
    return hasManualMinimumIntakeData(autosavePayload().opening_summary, autosavePayload().child_profile_draft)
  }

  function officerInformantErrors() {
    const missing: string[] = []
    if (!form.officer_user_id || !form.officer_surname || !form.officer_first_names) missing.push("Officer details must be available.")
    if (!form.informant_surname.trim()) missing.push("Informant surname is required.")
    if (!form.informant_first_names.trim()) missing.push("Informant first names are required.")
    if (!form.informant_sex) missing.push("Informant sex is required.")
    if (!form.informant_relationship_to_child) missing.push("Relationship to child is required.")
    if (!form.informant_phone.trim()) missing.push("Informant phone is required.")
    return missing
  }

  async function createManualDraftAfterChildDetails(nextTab: string) {
    const nextErrors = officerInformantErrors()
    if (nextErrors.length) {
      setErrors(nextErrors)
      return ""
    }
    const startedAt = manualIntakeStartedAt || new Date().toISOString()
    const payload = autosavePayload(nextTab)
    payload.opening_summary = {
      ...payload.opening_summary,
      source: "Manual intake",
      autosave_started_at: startedAt,
      last_active_tab: nextTab,
    }
    setAutosaveState("saving")
    try {
      const intake = await apiPost<IntakeRecord>("/intakes/", payload)
      const savedCase = caseFromIntake(intake, alerts, districts)
      saveDraftCase(savedCase)
      setLastTabs((items) => {
        const next = { ...items, [savedCase.id]: nextTab }
        window.localStorage.setItem(lastTabsStorageKey, JSON.stringify(next))
        return next
      })
      setForm((current) => ({
        ...current,
        intake_id: intake.id,
        case_id: savedCase.id,
        intake_number: `INT-${savedCase.id.replace("CASE-", "")}`,
        alert_received_at: "",
        date_reported: current.date_reported || dateInputValue(intake.created_at || startedAt),
      }))
      lastAutosavePayload.current = ""
      const savedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      setAutosavedAt(savedAt)
      setAutosaveState("saved")
      setSavedMessage(`Draft saved at ${savedAt}.`)
      setErrors([])
      return savedCase.id
    } catch (error) {
      setAutosaveState("error")
      setErrors([error instanceof Error ? error.message : "Could not start autosaving this intake."])
      return ""
    }
  }

  async function backToIntakeList() {
    if (mode === "manual" && !locked && !editRequestMode && form.intake_id && !manualDraftHasCapturedData()) {
      try {
        await apiDelete(`/intakes/${form.intake_id}/`)
      } catch (error) {
        setErrors([error instanceof Error ? error.message : "Could not discard the empty manual intake draft."])
        return
      }
      discardDraftCase(caseRecord("Draft"))
      setSelectedAlertId(alerts[0]?.id || "")
      setSavedMessage("")
    } else if (mode === "manual" && !locked && !editRequestMode && form.intake_id) {
      await autosaveDraft("manual")
      saveDraftCase(caseRecord("Draft"))
    }
    setWorkspace("list")
  }

  function planSummary(items: ActionPlanItem[], otherService: string) {
    return items.map((item) => `${serviceLabel(item.service, otherService)} - ${item.organisation || "Organisation to confirm"} - due ${item.deadline}`).join("\n")
  }

  function autosavePayload(activeTabOverride = activeTab) {
    const safeguarding = calculateSafeguardingClassification(form.selected_categories, form.immediate_danger === "Yes" || form.immediate_danger_reported === "Yes")
    return {
      intake_source: mode === "alert" ? "ALERT_REFERRAL" : "DIRECT_INTAKE",
      opening_summary: {
        source: mode === "manual" ? "Direct Intake" : "Alert Referral",
        // Store the whole-intake SLA start once; never replace it per tab save.
        autosave_started_at: mode === "manual" ? manualIntakeStartedAt || undefined : undefined,
        last_active_tab: activeTabOverride,
        ...(mode === "alert" ? { alert_id: form.alert_id, alert_referred_at: form.alert_received_at } : {}),
        case_id: form.case_id,
        intake_number: form.intake_number,
        date_reported: form.date_reported,
        reporting_channel: form.reporting_channel,
        concern_summary: form.concern_summary,
        reporter_narrative: form.reporter_narrative,
        emergency_reported: safeguarding.isEmergency ? "Yes" : "No",
        immediate_danger_reported: safeguarding.isImmediateDanger ? "Yes" : "No",
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
        },
        screening_draft: {
          selected_categories: form.selected_categories,
          juvenile_offences: form.juvenile_offences,
          juvenile_other_property_offence: form.juvenile_other_property_offence,
          alleged_perpetrator_known: form.alleged_perpetrator_known,
          accused_name: form.accused_name,
          accused_relationship_to_child: form.accused_relationship_to_child,
          accused_sex: form.accused_sex,
          accused_race: form.accused_race,
          referred_to_police: form.referred_to_police,
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
          immediate_danger: form.immediate_danger,
          system_recommended_risk: form.system_recommended_risk,
          vulnerability_factors: Array.from(new Set([...detectedVulnerabilityFactors, ...form.vulnerability_factors])),
          safety_concerns: form.safety_concerns,
          child_moved_to_safety: form.child_moved_to_safety,
          referral_authority_contacted: form.referral_authority_contacted,
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
        district: form.district,
        ward: form.ward,
        village: form.village,
        chief_name: form.chief_name,
        nearest_landmark: form.nearest_landmark,
        capture_latitude: form.capture_latitude,
        capture_longitude: form.capture_longitude,
        known: form.child_known,
        surname: form.child_surname,
        first_names: form.child_first_names,
        id_number: form.child_id_number,
        sex: form.child_sex,
        date_of_birth: form.child_date_of_birth,
        age: form.child_age,
        birth_registered: form.birth_registered,
        disability_status: form.disability_status,
        disability_description: form.disability_status === "Yes" ? form.disability_description : "",
        address_of_child: form.child_address,
        reasons_for_intended_inquiry: form.reasons_for_intended_inquiry,
        contact_details: form.child_contact_details,
        home_language: form.home_language,
        religion: form.religion,
        race: form.child_race,
      },
      referral_date: form.referral_date || null,
      case_referred_by: form.case_referred_by.trim(),
      alleged_perpetrators: allegedPerpetrators,
      household_profile_draft: {
        family_members: guardians,
        draft_family_member: guardianDraft,
        caregiving_circumstances: form.caregiving_circumstances,
      },
      background_information: {
        previous_contacts: form.previous_contacts,
        other_background_information: form.other_background_information,
        child_story_or_reported_circumstances: form.child_story_or_reported_circumstances,
        background_service_notes: form.background_service_notes,
        caregiving_circumstances: form.caregiving_circumstances,
      },
      initial_screening_notes: form.screening_notes,
      case_category: primaryCaseCategory,
      risk_level: form.risk_level || "Pending",
      is_emergency: safeguarding.isEmergency,
      is_immediate_danger: safeguarding.isImmediateDanger,
      priority_level: safeguarding.isImmediateDanger ? "Critical" : safeguarding.isEmergency ? "Emergency" : "Normal",
      emergency_classification: (safeguarding.isImmediateDanger ? "EMERGENCY_IMMEDIATE_DANGER" : safeguarding.isEmergency ? "EMERGENCY" : "NON_EMERGENCY") as EmergencyClassification,
      child_moved_to_safety: form.child_moved_to_safety,
      emergency_change_reason: form.emergency_change_reason,
    }
  }

  async function autosaveDraft(reason = "auto", activeTabOverride = activeTab) {
    if (isHydratingIntake.current || workspace !== "form" || locked || editRequestMode || !form.intake_id) return
    const payload = autosavePayload(activeTabOverride)
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

  function toggleArray(key: "selected_categories" | "juvenile_offences" | "vulnerability_factors" | "recommended_services" | "background_services" | "immediate_response_actions", item: string) {
    if (fieldsLocked) return
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
      return { ...current, [key]: next }
    })
  }

  function updateActionPlanItem(index: number, field: keyof ActionPlanItem, value: string) {
    setForm((current) => {
      const actionItems = current.action_plan_items.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item))
      return { ...current, action_plan_items: actionItems, action_plan: planSummary(actionItems, current.other_recommended_service) }
    })
  }

  function familyMemberName(member: GuardianDraft) {
    return [member.first_names, member.surname].filter(Boolean).join(" ") || member.name
  }

  function familyMemberType(member: GuardianDraft) {
    return member.family_member_type || member.guardian_type || member.person_category || "Family member"
  }

  function familyMemberStatus(member: GuardianDraft) {
    return member.living_involvement_status || member.is_deceased_or_abandoned || "-"
  }

  function updateGuardianDraft(patch: Partial<GuardianDraft>) {
    setGuardianDraft((current) => {
      const next = { ...current, ...patch }
      if (patch.person_category) {
        next.family_member_type = ""
        next.guardian_type = ""
        next.living_involvement_status = ""
        if (patch.person_category === "Significant Other") next.telephone = ""
      }
      if (patch.family_member_type !== undefined && !showsWifeDetails(next.family_member_type)) {
        next.number_of_wives = ""
        next.order_of_wife = ""
      }
      if (patch.living_involvement_status && patch.living_involvement_status !== "Deceased") next.date_deceased = ""
      if (patch.living_involvement_status && patch.living_involvement_status !== "Abandoned") next.date_abandoned = ""
      return next
    })
  }

  function updateFamilyMemberBirthDate(value: string) {
    setGuardianDraft((current) => {
      if (!value) return { ...current, date_of_birth: "", estimated_age: "", dob_or_age: "", dob_entry_mode: "" }
      if (current.dob_entry_mode === "estimated") {
        return { ...current, date_of_birth: value, dob_or_age: current.estimated_age || current.dob_or_age }
      }
      const age = calculateAgeFromBirthDate(value)
      return { ...current, date_of_birth: value, estimated_age: age, dob_or_age: age, dob_entry_mode: "exact" }
    })
  }

  function updateFamilyMemberEstimatedAge(value: string) {
    const cleanAge = value.replace(/[^\d]/g, "").slice(0, 3)
    setGuardianDraft((current) => {
      if (current.dob_entry_mode === "exact" && current.date_of_birth) return current
      return {
        ...current,
        estimated_age: cleanAge,
        dob_or_age: cleanAge,
        date_of_birth: cleanAge ? estimatedBirthMonthFromAge(cleanAge) : "",
        dob_entry_mode: cleanAge ? "estimated" : "",
      }
    })
  }

  function familyMemberDobFields() {
    const estimatedMode = guardianDraft.dob_entry_mode === "estimated"
    const range = estimatedBirthMonthRange(guardianDraft.estimated_age || guardianDraft.dob_or_age)
    return <>
      <Field label={estimatedMode ? "Estimated birth month/year" : "Date of birth"} required={false}>
        <input
          className={inputClass}
          type={estimatedMode ? "month" : "date"}
          value={guardianDraft.date_of_birth}
          min={estimatedMode ? range.min : undefined}
          max={estimatedMode ? range.max : isoDateFromLocalDate(new Date())}
          onChange={(e) => updateFamilyMemberBirthDate(e.target.value)}
        />
      </Field>
      <Field label="Age" required={false}>
        <input
          className={`${inputClass} ${guardianDraft.dob_entry_mode === "exact" ? "bg-[#f1f5f9] text-[#64748b]" : ""}`}
          value={guardianDraft.estimated_age || guardianDraft.dob_or_age}
          onChange={(e) => updateFamilyMemberEstimatedAge(e.target.value)}
          readOnly={guardianDraft.dob_entry_mode === "exact"}
          placeholder={guardianDraft.dob_entry_mode === "exact" ? "Calculated from DOB" : "Enter estimated age"}
        />
      </Field>
    </>
  }

  function openAddGuardianModal() {
    setEditingGuardianIndex(null)
    setGuardianDraft(emptyGuardianDraft())
    setShowGuardianModal(true)
  }

  function openEditGuardianModal(index: number) {
    if (locked) return
    setEditingGuardianIndex(index)
    setGuardianDraft(normalizeFamilyMemberDraft(guardians[index]))
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
    const nameMissing = !guardianDraft.surname || !guardianDraft.first_names
    const birthMonthRange = estimatedBirthMonthRange(guardianDraft.estimated_age || guardianDraft.dob_or_age)
    const estimatedMonthOutOfRange = guardianDraft.dob_entry_mode === "estimated"
      && guardianDraft.date_of_birth
      && birthMonthRange.min
      && birthMonthRange.max
      && (guardianDraft.date_of_birth < birthMonthRange.min || guardianDraft.date_of_birth > birthMonthRange.max)
    const missing = !guardianDraft.person_category || nameMissing
    if (missing) {
      setErrors(["Person category and name details are required."])
      return
    }
    if (estimatedMonthOutOfRange) {
      setErrors(["Estimated birth month must stay within the selected age range."])
      return
    }
    if (showsWifeDetails(guardianDraft.family_member_type || guardianDraft.guardian_type) && guardianDraft.number_of_wives) {
      const numberOfWives = Number(guardianDraft.number_of_wives)
      if (!Number.isInteger(numberOfWives) || numberOfWives < 1) {
        setErrors(["Enter a valid positive whole number for number of wives."])
        return
      }
    }
    setGuardians((items) => {
      const cleanDraft = { ...guardianDraft, name: [guardianDraft.first_names, guardianDraft.surname].filter(Boolean).join(" ") }
      if (editingGuardianIndex === null) return [...items, cleanDraft]
      return items.map((item, itemIndex) => (itemIndex === editingGuardianIndex ? cleanDraft : item))
    })
    closeGuardianModal()
    setErrors([])
  }

  function openAddAccusedModal() {
    setEditingAccusedIndex(null)
    setAccusedDraft(emptyAllegedPerpetrator())
    setShowAccusedModal(true)
  }

  function openEditAccusedModal(index: number) {
    if (fieldsLocked) return
    setEditingAccusedIndex(index)
    setAccusedDraft({ ...emptyAllegedPerpetrator(), ...allegedPerpetrators[index] })
    setShowAccusedModal(true)
  }

  function closeAccusedModal() {
    setShowAccusedModal(false)
    setEditingAccusedIndex(null)
    setAccusedDraft(emptyAllegedPerpetrator())
  }

  function updateAccusedDraft(field: keyof AllegedPerpetratorDraft, value: string) {
    setAccusedDraft((current) => ({ ...current, [field]: value,
      ...(field === "referred_to_police" && value !== "Yes" ? { police_referral_date: "" } : {}),
      ...(field === "court_appearance_scheduled" && value !== "Yes" ? { court_appearance_date: "" } : {}),
      ...(field === "conviction_determined" && value !== "Yes" ? { conviction_date: "" } : {}),
    }))
  }

  function saveAccusedPerson() {
    const missing = !accusedDraft.name.trim() ? "Accused name is required." : ""
    if (missing) { setErrors([missing]); return }
    const clean = { ...accusedDraft, id: accusedDraft.id || `accused-${Date.now()}`, name: accusedDraft.name.trim() }
    setAllegedPerpetrators((items) => editingAccusedIndex === null ? [...items, clean] : items.map((item, index) => index === editingAccusedIndex ? clean : item))
    setErrors([])
    closeAccusedModal()
  }

  function removeAccusedPerson(index: number) {
    if (!fieldsLocked) setAllegedPerpetrators((items) => items.filter((_, itemIndex) => itemIndex !== index))
  }

  function runDuplicateCheck(showMessage = true) {
    const normalize = (value: unknown) => `${value || ""}`.trim().toLowerCase()
    const childName = normalize(`${form.child_first_names} ${form.child_surname}`)
    const guardianNames = guardians
      .map((guardian) => normalize(`${guardian.first_names} ${guardian.surname}`))
      .filter(Boolean)
    const guardianPhones = guardians.map((guardian) => normalize(guardian.telephone)).filter(Boolean)
    const openGuardianName = normalize(familyMemberName(guardianDraft))
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
        if (form.selected_categories.includes(item.concern) || item.concern === primaryCaseCategory) {
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
    const factors = Array.from(new Set([...detectedVulnerabilityFactors, ...form.vulnerability_factors])).map((item) => item.toLowerCase())
    const categories = form.selected_categories.map((item) => item.toLowerCase())
    let risk = "LOW"
    if (safeguardingState.isImmediateDanger || (factors.includes("sexual abuse alleged") && factors.includes("perpetrator has access to child"))) risk = "CRITICAL"
    else if (safeguardingState.isEmergency) risk = "HIGH"
    else if (categories.includes("sexual abuse") || factors.includes("trafficking suspected") || factors.includes("child abandoned") || factors.includes("child living on streets")) risk = "HIGH"
    else if (categories.some((item) => ["neglect", "educational support", "food insecurity", "medical support / amto"].includes(item))) risk = "MEDIUM"
    setForm((current) => ({ ...current, system_recommended_risk: risk, risk_level: risk }))
    if (showMessage) setSavedMessage(`Risk calculated as ${risk}.`)
  }

  function validateForSubmit() {
    const nextErrors: string[] = []
    if (!form.child_sex) nextErrors.push("Child sex must be selected, or UNKNOWN.")
    if (!form.child_date_of_birth && !form.child_age) nextErrors.push("Child age or date of birth is required.")
    if (!form.selected_categories.length) nextErrors.push("Select at least one case type.")
    if (requiresProsecution && !form.alleged_perpetrator_known) nextErrors.push("Perpetrator known is required for the selected case category.")
    if (requiresProsecution && form.alleged_perpetrator_known === "Yes" && !allegedPerpetrators.length) nextErrors.push("Add at least one accused person when perpetrator known is Yes.")
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
      concern: primaryCaseCategory || "Uncategorized",
      riskLevel: form.risk_level,
      status,
      intakeOfficer: `${form.officer_first_names} ${form.officer_surname}`.trim(),
      createdAt: form.alert_received_at || selectedCase?.createdAt || new Date().toISOString(),
      screeningCompletedAt: status === "Pending Supervisor Review" ? form.submitted_for_review_at || new Date().toISOString() : selectedCase?.screeningCompletedAt,
      submittedForReviewAt: status === "Pending Supervisor Review" ? form.submitted_for_review_at || new Date().toISOString() : selectedCase?.submittedForReviewAt,
      description: form.reporter_narrative,
      background_information: {
        previous_contacts: form.previous_contacts,
        other_background_information: form.other_background_information,
        child_story_or_reported_circumstances: form.child_story_or_reported_circumstances,
        background_service_notes: form.background_service_notes,
      },
      isEmergency: safeguardingState.isEmergency,
      isImmediateDanger: safeguardingState.isImmediateDanger,
      priorityLevel: safeguardingState.isImmediateDanger ? "Critical" : safeguardingState.isEmergency ? "Emergency" : "Normal",
      emergencyClassification: (safeguardingState.isImmediateDanger ? "EMERGENCY_IMMEDIATE_DANGER" : safeguardingState.isEmergency ? "EMERGENCY" : "NON_EMERGENCY") as EmergencyClassification,
      manualMinimumComplete: mode !== "manual" || manualDraftHasCapturedData(),
    }
  }

  function saveDraft() {
    void autosaveDraft("manual")
    saveDraftCase(caseRecord("Draft"))
    if (mode === "alert") updateAlert(alert.id, { status: "Intake In Progress", internalStatus: "Intake In Progress", intakeOfficer: `${form.officer_first_names} ${form.officer_surname}`.trim(), riskLevel: form.risk_level, caseCategory: primaryCaseCategory })
    setSavedMessage("Draft saved.")
    setErrors([])
  }

  async function submitToSupervisor() {
    if (locked) return
    calculateRisk(false)
    const nextErrors = validateForSubmit()
    if (nextErrors.length) {
      setErrors(nextErrors)
      if (!form.selected_categories.length) {
        setActiveTab("case")
        window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }))
      }
      return
    }
    const submittedAt = new Date().toISOString()
    const submittedPayload = {
      ...autosavePayload(),
      opening_summary: {
        ...autosavePayload().opening_summary,
        screening_draft: {
          ...autosavePayload().opening_summary.screening_draft,
          screening_outcome: form.screening_outcome || "PROCEED_TO_ASSESSMENT",
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
    setForm((current) => ({ ...current, status: "PENDING_SUPERVISOR_REVIEW", screening_outcome: current.screening_outcome || "PROCEED_TO_ASSESSMENT", submitted_for_review_at: submittedAt }))
    saveDraftCase({ ...caseRecord("Pending Supervisor Review"), submittedForReviewAt: submittedAt })
    if (mode === "alert") updateAlert(alert.id, { status: "Pending Supervisor Review", internalStatus: "Pending Supervisor Review", intakeOfficer: `${form.officer_first_names} ${form.officer_surname}`.trim(), riskLevel: form.risk_level, caseCategory: primaryCaseCategory, actionPlan: form.immediate_action_plan || form.action_plan })
    setErrors([])
    const detail = `Case ${form.case_id} has been submitted successfully to the DSDO allocation queue.`
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
    if (isSystemAdmin) {
      setSavedMessage("System administrators have read-only access to cases.")
      return
    }
    setMode("manual")
    setAllegedPerpetrators([])
    const manualCaseId = "Draft"
    const createdAt = new Date().toISOString()
    setManualIntakeStartedAt(createdAt)
    setForm((current) => ({
      ...current,
      intake_id: null,
      alert_id: "",
      case_id: manualCaseId,
      intake_number: "",
      intake_source: "DIRECT_INTAKE",
      status: "INTAKE_IN_PROGRESS",
      alert_received_at: "",
      date_reported: dateInputValue(createdAt),
      reporting_channel: "",
      district: "",
      ward: "",
      village: "",
      chief_name: "",
      nearest_landmark: "",
      concern_summary: "",
      reporter_narrative: "",
      emergency_reported: "",
      immediate_danger_reported: "",
      immediate_action_at: "",
      immediate_action_responsible: "",
      immediate_action_status: "",
      supervisor_notified: "",
      supervisor_notification_at: "",
      supervisor_notified_no_reason: "",
      child_moved_to_safety: "",
      referral_authority_contacted: "",
      emergency_change_reason: "",
      officer_user_id: defaultOfficer.officer_user_id,
      officer_surname: defaultOfficer.officer_surname,
      officer_first_names: defaultOfficer.officer_first_names,
      officer_designation: defaultOfficer.officer_designation,
      officer_district: defaultOfficer.officer_district,
      officer_contact: defaultOfficer.officer_contact,
      child_known: "",
      child_surname: "",
      child_first_names: "",
      child_id_number: "",
      child_sex: "",
      child_date_of_birth: "",
      child_age: "",
      birth_registered: "",
      disability_status: "",
      disability_description: "",
      child_address: "",
      referral_date: "",
      case_referred_by: "",
      reasons_for_intended_inquiry: "",
      child_contact_details: "",
      home_language: "",
      religion: "",
      child_race: "",
      selected_categories: [],
      juvenile_offences: [],
      juvenile_other_property_offence: "",
      risk_level: "",
      system_recommended_risk: "",
      action_plan: "",
      recommended_services: [],
      other_recommended_service: "",
      action_plan_items: [],
      background_organisation: "",
      background_services: [],
      other_background_service: "",
      background_service_notes: "",
      caregiving_circumstances: "",
      previous_contacts: emptyPreviousContacts(),
      other_background_information: "",
      child_story_or_reported_circumstances: "",
    }))
    setActiveTab("officer")
    setWorkspace("form")
    setErrors([])
    setSavedMessage("Manual intake started.")
    setAutosaveState("idle")
    setAutosavedAt("")
    lastAutosavePayload.current = ""
  }

  if (workspace === "list") {
    return (
      <Panel title="Case Intake" icon={FileText} action={`${intakeRows.length} intakes`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-[#64748b]">Open a draft to continue capturing, or review submitted and escalated intakes in read-only mode.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {["All", "Normal", "Emergency", "Immediate danger"].map((item) => (
              <button key={item} className={`h-10 rounded-md border px-3 text-sm font-semibold ${intakeEmergencyFilter === item ? "border-[#008c7a] bg-[#e7f6f3] text-[#007464]" : "border-[#d8dee8] bg-white text-[#50617a]"}`} onClick={() => setIntakeEmergencyFilter(item as typeof intakeEmergencyFilter)}>{item}</button>
            ))}
            {!isSystemAdmin && <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={startManualIntake}><Plus className="h-4 w-4" /> Manual intake</button>}
          </div>
        </div>
        <div className="overflow-hidden rounded-md border border-[#d8dee8] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
              <thead className="bg-[#f8fafc] text-[#2e6fa3]">
                <tr>{["Case ID", "Alert ID", "Child", "Province", "District", "Ward", "Status", "Primary concern", "Safeguarding", "Risk", "Screening SLA", "Officer"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-2.5">{head}</th>)}</tr>
              </thead>
              <tbody>
                {intakePageRows.map((caseRecord) => {
                  const screeningSla = calculateScreeningSla(alerts.find((item) => item.id === caseRecord.sourceAlertId)?.submittedAt || caseRecord.createdAt, caseRecord.riskLevel, caseRecord.status, clockTick, caseRecord.submittedForReviewAt)
                  return (
                  <tr key={caseRecord.id} className="bg-white hover:bg-[#f8fafc]">
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">
                      <button className="font-bold text-[#30528c] underline-offset-2 hover:text-[#008c7a] hover:underline" onClick={() => openCaseIntake(caseRecord)}>{caseRecord.id}</button>
                    </td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">
                      {caseRecord.sourceAlertId ? (
                        <button className="font-semibold text-[#30528c] underline-offset-2 hover:text-[#008c7a] hover:underline" onClick={() => openAlertDetails(caseRecord.sourceAlertId)}>
                          {caseRecord.sourceAlertId}
                        </button>
                      ) : "Manual"}
                    </td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{caseRecord.childName}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{provinceNameForCase(caseRecord, districts)}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{caseRecord.district}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{caseRecord.ward}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5"><CaseStatusBadge status={caseRecord.status} /></td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{caseRecord.concern}</td>
                    <td className={`border-b border-[#edf0f4] px-3 py-2.5 text-xs font-bold uppercase ${emergencyBadgeLabel(caseRecord) ? "text-[#a05b16]" : "text-[#64748b]"}`}>{emergencyBadgeLabel(caseRecord) || "Normal"}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{caseRecord.riskLevel}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5"><span className={`text-xs font-bold ${["OVERDUE", "BREACHED", "SUBMITTED LATE"].includes(screeningSla.status) ? "text-[#b42318]" : screeningSla.status === "DUE SOON" ? "text-[#a05b16]" : "text-[#007464]"}`}>{screeningSla.status}</span><span className="ml-2 whitespace-nowrap text-xs font-semibold text-[#64748b]">{screeningSla.label}</span></td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{caseRecord.intakeOfficer || "-"}</td>
                  </tr>
                )})}
                {!intakePageRows.length && <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={12}>No intakes are available.</td></tr>}
              </tbody>
            </table>
          </div>
          <TablePagination totalRows={intakeRows.length} pageStart={intakePageStart} pageEnd={intakePageEnd} rowsPerPage={intakeRowsPerPage} setRowsPerPage={setIntakeRowsPerPage} page={safeIntakePage} pageCount={intakePageCount} setPage={setIntakePage} />
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
              <h1 className="text-[20px] font-bold text-[#263747]">Case Intake</h1>
              <StatusPill label={isNewManualIntake ? "New Manual Intake" : form.status.replace(/_/g, " ")} tone={form.status === "EMERGENCY_ESCALATED" ? "danger" : ["PENDING_SUPERVISOR_REVIEW", "APPROVED_FOR_ALLOCATION", "ALLOCATED"].includes(form.status) ? "review" : "draft"} />
              {emergencyState.isEmergency && <EmergencyBadge label={emergencyState.isImmediateDanger ? "IMMEDIATE DANGER" : "EMERGENCY"} />}
              {!screeningClosed && sla.status !== "ON TIME" && <StatusPill label={sla.status} tone={sla.status === "DUE SOON" ? "warning" : "danger"} />}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-sm text-[#64748b]">
              <span>{form.case_id} |</span>
              {isAlertReferral && form.alert_id ? <button className="font-semibold text-[#30528c] hover:text-[#008c7a] hover:underline" onClick={() => openAlertDetails(form.alert_id)}>{form.alert_id}</button> : <span>Direct intake</span>}
              <span>| {form.child_known === "No" ? "Unknown Child" : `${form.child_first_names} ${form.child_surname}`.trim() || "Unknown Child"} | {form.district} | {primaryCaseCategory || "Uncategorized"}</span>
            </div>
            {!locked && !editRequestMode && form.intake_id && (
              <div className={`mt-2 text-xs font-bold ${autosaveState === "error" ? "text-[#b42318]" : autosaveState === "saving" ? "text-[#a05b16]" : "text-[#007464]"}`}>
                {autosaveState === "saving" ? "Saving..." : autosaveState === "dirty" ? "Unsaved changes" : autosaveState === "error" ? "Save failed" : autosavedAt ? `Saved ${autosavedAt}` : "Draft saved"}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="grid gap-1 text-right">
              <div className="text-xs font-bold uppercase text-[#64748b]">{screeningClosed ? "Screening SLA" : "SLA countdown"}</div>
              <div className={`text-[18px] font-bold ${sla.status.includes("ON TIME") || sla.status === "ON TIME" ? "text-[#007464]" : sla.status === "DUE SOON" ? "text-[#a05b16]" : "text-[#b42318]"}`}>{screeningClosed ? sla.status : sla.label}</div>
            </div>
            {canRequestUpdate && currentCaseRecord ? <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]" onClick={() => onReturnToCaseWorkspace(currentCaseRecord)}>Back to Case Workspace</button> : <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={backToIntakeList}>Back to list</button>}
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
            <span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-semibold text-[#475569]">{isSystemAdmin ? "Read-only system administrator view" : editRequestMode ? "Edit request mode" : locked ? `Locked - ${form.status.replace(/_/g, " ").toLowerCase()}` : "Draft editable"}</span>
            {!editRequestMode && editTabButton()}
          </div>
        )}
      >
        {editRequestMode && (
          <div className="mb-4 rounded-md border border-[#f3d38b] bg-[#fffaf0] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-[#263747]">You are now requesting changes to locked intake data.</h3>
                <p className="mt-1 text-sm font-semibold text-[#8a5a12]">Changes will not update the case until supervisor approval. Edit only what needs correction on this tab.</p>
              </div>
              <StatusPill label={`${detectedUpdateChanges().length} changed`} tone={detectedUpdateChanges().length ? "warning" : "draft"} />
            </div>
          </div>
        )}
        <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-[#d8dee8]">
          {tabs.map(([key, label]) => (
            <button key={key} disabled={editRequestMode && key !== activeTab} className={`relative min-h-10 whitespace-nowrap rounded-t-md px-3 text-[13px] font-extrabold uppercase tracking-normal transition disabled:cursor-not-allowed disabled:opacity-45 ${activeTab === key ? "bg-[#e7f6f3] text-[#007464]" : "text-[#31476b] hover:bg-[#f8fafc] hover:text-[#008c7a]"}`} onClick={() => void setTab(key)}>
              {label}
              {activeTab === key && <span className="absolute bottom-[-1px] left-0 h-1 w-full rounded-t bg-[#008c7a]" />}
            </button>
          ))}
        </div>

        <fieldset disabled={fieldsLocked && activeTab !== "case"} className={`min-w-0 ${fieldsLocked ? "opacity-80" : ""}`}>
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
                  <h3 className="text-base font-bold text-[#263747]">Informant Details</h3>
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
                    <div className="md:col-span-2"><ReadonlyArea label="Address" value={form.informant_address} /></div>
                  </FormGrid>
                ) : (
                  <FormGrid>
                    <Field label="Surname"><input className={inputClass} value={form.informant_surname} onChange={(e) => setValue("informant_surname", e.target.value)} /></Field>
                    <Field label="First names"><input className={inputClass} value={form.informant_first_names} onChange={(e) => setValue("informant_first_names", e.target.value)} /></Field>
                    <Field label="ID number"><input className={inputClass} value={form.informant_id_number} onChange={(e) => setValue("informant_id_number", e.target.value)} /></Field>
                    <Field label="Sex"><select className={inputClass} value={form.informant_sex} onChange={(e) => setValue("informant_sex", e.target.value)}><option value="">Select sex</option><option>MALE</option><option>FEMALE</option><option>UNKNOWN</option></select></Field>
                    <Field label="Relationship to child"><RelationshipSelect value={form.informant_relationship_to_child} onChange={(value) => setValue("informant_relationship_to_child", value)} relationshipTypes={relationshipTypes} /></Field>
                    <Field label="Phone"><input className={inputClass} value={form.informant_phone} onChange={(e) => setValue("informant_phone", e.target.value)} /></Field>
                    <Field label="Email"><input className={inputClass} value={form.informant_email} onChange={(e) => setValue("informant_email", e.target.value)} /></Field>
                    <Field label="Organization"><input className={inputClass} value={form.informant_organization} onChange={(e) => setValue("informant_organization", e.target.value)} /></Field>
                    <div className="md:col-span-2"><Field label="Address" required={false}><textarea className={`${inputClass} min-h-[90px] py-3`} value={form.informant_address} onChange={(e) => setValue("informant_address", e.target.value)} /></Field></div>
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
                <Field label="Sex"><select className={`${inputClass} ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={form.child_sex} onChange={(e) => setValue("child_sex", e.target.value)} disabled={childUnknown}><option value="">Select sex</option><option>MALE</option><option>FEMALE</option><option>UNKNOWN</option></select></Field>
                <Field label="Date of birth"><input className={`${inputClass} ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} type="date" value={form.child_date_of_birth} onChange={(e) => setValue("child_date_of_birth", e.target.value)} disabled={childUnknown} /></Field>
                <Field label="Age"><input className={`${inputClass} ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={form.child_age} onChange={(e) => setValue("child_age", e.target.value)} disabled={childUnknown} /></Field>
                <Field label="Birth registered"><select className={`${inputClass} ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={form.birth_registered} onChange={(e) => setValue("birth_registered", e.target.value)} disabled={childUnknown}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                <Field label="Disability status"><select className={`${inputClass} ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={form.disability_status} onChange={(e) => setValue("disability_status", e.target.value)} disabled={childUnknown}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                <Field label="Contact details"><input className={`${inputClass} ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={form.child_contact_details} onChange={(e) => setValue("child_contact_details", e.target.value)} disabled={childUnknown} /></Field>
                <Field label="Home language"><select className={`${inputClass} ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={form.home_language} onChange={(e) => setValue("home_language", e.target.value)} disabled={childUnknown}><option value="">Select home language</option>{HOME_LANGUAGE_OPTIONS.map((language) => <option key={language}>{language}</option>)}</select></Field>
                <Field label="Religion"><select className={`${inputClass} ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={form.religion} onChange={(e) => setValue("religion", e.target.value)} disabled={childUnknown}><option value="">Select religion</option>{RELIGION_OPTIONS.map((religion) => <option key={religion}>{religion}</option>)}</select></Field>
                <Field label="Race"><select className={`${inputClass} ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={form.child_race} onChange={(e) => setValue("child_race", e.target.value)} disabled={childUnknown}><option value="">Select race</option>{RACE_OPTIONS.map((race) => <option key={race}>{race}</option>)}</select></Field>
                <Field label="District" required={false}><input className={inputClass} type="text" value={form.district} onChange={(e) => setValue("district", e.target.value)} placeholder="Enter district" /></Field>
                <Field label="Ward number" required={false}><input className={inputClass} type="text" inputMode="numeric" pattern="[0-9]*" value={form.ward} onChange={(e) => setValue("ward", e.target.value.replace(/[^0-9]/g, ""))} placeholder="Enter ward number" /></Field>
                <Field label="Village"><input className={inputClass} value={form.village} onChange={(e) => setValue("village", e.target.value)} /></Field>
                <Field label="Chief name"><input className={inputClass} value={form.chief_name} onChange={(e) => setValue("chief_name", e.target.value)} /></Field>
                <Field label="Address of Child"><input className={`${inputClass} ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={form.child_address} onChange={(e) => setValue("child_address", e.target.value)} disabled={childUnknown} /></Field>
                <Field label="Date of referral"><input className={inputClass} type="date" value={form.referral_date} onChange={(e) => setValue("referral_date", e.target.value)} /></Field>
                <Field label="Case referred by"><input className={inputClass} value={form.case_referred_by} onChange={(e) => setValue("case_referred_by", e.target.value)} placeholder="Name, organisation, or referring authority" /></Field>
                <div className="md:col-span-2"><Field label="Nearest landmark"><input className={inputClass} value={form.nearest_landmark} onChange={(e) => setValue("nearest_landmark", e.target.value)} placeholder="School, clinic, shop, church, road, or known place nearby" /></Field></div>
                <div className="md:col-span-2"><Field label="Reasons for intended Inquiry - For Children in Need of Care Indicate Definition and Section of the Children's Act [Chapter 5:06]"><textarea className={`${inputClass} min-h-[90px] py-3`} value={form.reasons_for_intended_inquiry} onChange={(e) => setValue("reasons_for_intended_inquiry", e.target.value)} /></Field></div>
                {form.disability_status === "Yes" && <div className="md:col-span-2"><Field label="Disability description"><textarea className={`${inputClass} min-h-[90px] py-3 ${childUnknown ? "bg-[#f1f5f9] text-[#8aa0bf]" : ""}`} value={form.disability_description} onChange={(e) => setValue("disability_description", e.target.value)} disabled={childUnknown} /></Field></div>}
              </FormGrid>
            </section>
          )}

          {activeTab === "family" && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h3 className="text-base font-bold text-[#263747]">Family Details</h3><p className="text-sm text-[#64748b]">Capture parents, guardians, siblings, relatives and other important persons involved in the child's life.</p></div>
                <div className="flex flex-wrap gap-2">
                  {!fieldsLocked && <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={openAddGuardianModal}><Plus className="h-4 w-4" /> Add Family Member</button>}
                </div>
              </div>
              <div className="overflow-x-auto rounded-md border border-[#d8dee8]">
                <table className="w-full min-w-[1050px] border-collapse text-left text-sm">
                  <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Type", "Name", "Age", "National ID", "Occupation", "Telephone", "Wives / names", "Action"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
                  <tbody>
                    {guardians.length ? guardians.map((item, index) => (
                      <tr key={`${item.telephone}-${index}`} className={`bg-white ${fieldsLocked ? "" : "cursor-pointer hover:bg-[#f8fafc]"}`} onClick={() => openEditGuardianModal(index)}>
                        <td className="border-b border-[#edf0f4] px-3 py-3 font-semibold text-[#263747]">{familyMemberType(item)}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3">{familyMemberName(item) || "-"}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3">{item.estimated_age || item.dob_or_age || "-"}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3">{item.id_number || "-"}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3">{item.occupation || "-"}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3">{item.telephone || "-"}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3">{[item.number_of_wives, item.order_of_wife].filter(Boolean).join(" / ") || "-"}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3">
                          <div className="flex items-center gap-2">
                            <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#2e6fa3] hover:border-[#008c7a] hover:text-[#008c7a] disabled:cursor-not-allowed disabled:opacity-45" title="Edit family member" disabled={fieldsLocked} onClick={(event) => { event.stopPropagation(); openEditGuardianModal(index) }}>
                              <PencilLine className="h-4 w-4" />
                            </button>
                            <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#f4b4ac] bg-white text-[#b42318] hover:bg-[#fff7f5] disabled:cursor-not-allowed disabled:opacity-45" title="Delete family member" disabled={fieldsLocked} onClick={(event) => { event.stopPropagation(); deleteGuardian(index) }}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={7}>No family member captured yet.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="rounded-md border border-[#d8dee8] bg-white p-4">
                <Field label="The circumstance of parents (state the relationships - whether these are biological parents or other cares)" required={false}>
                  <textarea className={`${inputClass} min-h-[130px] py-3`} value={form.caregiving_circumstances} onChange={(e) => setValue("caregiving_circumstances", e.target.value)} placeholder="Explain caregiving arrangements, parental relationships, absence, abandonment, biological parents, guardians or important family circumstances." />
                </Field>
              </div>
            </div>
          )}

          {activeTab === "case" && (
            <div className="space-y-5">
              <ConcernAccordion
                title="Protection Case Types"
                selectedCount={selectedCaseConcernCount(protectionTypeSections.flatMap((section) => section.items))}
                open={openCaseConcernSections.includes("protection")}
                onToggle={() => toggleCaseConcernSection("protection")}
              >
                <CaseTypeSection title="Protection Case Types" sections={protectionTypeSections} selected={form.selected_categories} onToggle={(item) => toggleArray("selected_categories", item)} readOnly={fieldsLocked} />
              </ConcernAccordion>
              <ConcernAccordion
                title="Welfare Case Types"
                selectedCount={selectedCaseConcernCount(welfareTypeSections.flatMap((section) => section.items))}
                open={openCaseConcernSections.includes("welfare")}
                onToggle={() => toggleCaseConcernSection("welfare")}
              >
                <CaseTypeSection title="Welfare Case Types" sections={welfareTypeSections} selected={form.selected_categories} onToggle={(item) => toggleArray("selected_categories", item)} readOnly={fieldsLocked} />
              </ConcernAccordion>
              <ConcernAccordion
                title="Other Concern"
                selectedCount={form.selected_categories.includes("Other") ? 1 : 0}
                open={openCaseConcernSections.includes("other")}
                onToggle={() => toggleCaseConcernSection("other")}
              >
                <CaseTypeGroup title="Other Concern" items={["Other"]} selected={form.selected_categories} onToggle={(item) => toggleArray("selected_categories", item)} readOnly={fieldsLocked} />
              </ConcernAccordion>
              {requiresJuvenileOffences && <section className="overflow-hidden rounded-md border border-[#d8dee8] bg-white">
                <button type="button" className="flex w-full items-center justify-between gap-3 bg-[#f8fafc] px-4 py-4 text-left hover:bg-[#f1f5f9]" onClick={() => toggleCaseConcernSection("juvenile-offences")} aria-expanded={juvenileOffencesOpen}>
                  <span className="text-sm font-bold uppercase text-[#2e6fa3]">Juvenile Delinquency Offences <span className="font-normal normal-case text-[#64748b]">(if applicable)</span></span>
                  <span className="inline-flex items-center gap-2"><span className="rounded-full bg-[#eef2f5] px-2.5 py-1 text-xs font-bold text-[#50617a]">{form.juvenile_offences.length} selected</span><ChevronDown className={`h-5 w-5 text-[#5f7191] transition ${juvenileOffencesOpen ? "rotate-180" : ""}`} /></span>
                </button>
                {juvenileOffencesOpen && <div className="border-t border-[#d8dee8] p-4"><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                  {juvenileOffenceGroups.map((group) => <div key={group.title}><h4 className="mb-2 text-sm font-extrabold text-[#263747]">{group.title}</h4><div className="space-y-2">{group.options.map((item) => <label key={item} className="flex items-start gap-2 text-sm text-[#263747]"><input type="checkbox" disabled={fieldsLocked} className="mt-0.5 h-4 w-4 accent-[#008c7a]" checked={form.juvenile_offences.includes(item)} onChange={() => toggleArray("juvenile_offences", item)} /><span>{item === "Other property offence" ? "Other" : item}</span></label>)}</div>{group.title === "Offences against property" && form.juvenile_offences.includes("Other property offence") && <input aria-label="Other property offence" disabled={fieldsLocked} className={`${inputClass} mt-2 h-10`} placeholder="Specify other offence" value={form.juvenile_other_property_offence} onChange={(event) => setValue("juvenile_other_property_offence", event.target.value)} />}</div>)}
                </div></div>}
              </section>}
              <section className="overflow-hidden rounded-md border border-[#d8dee8] bg-white">
                <button type="button" className="flex w-full items-center justify-between gap-3 bg-[#f8fafc] px-4 py-4 text-left hover:bg-[#f1f5f9]" onClick={() => requiresProsecution && toggleCaseConcernSection("prosecution")} aria-expanded={prosecutionOpen}>
                  <span className="block text-sm font-bold uppercase text-[#2e6fa3]">Prosecution / Alleged Perpetrator</span>
                  <span className="inline-flex shrink-0 items-center gap-2">
                    <StatusPill label={allegedPerpetrators.length ? `${allegedPerpetrators.length} accused captured` : requiresProsecution ? "Required for selected category" : "Collapsed until relevant"} tone={allegedPerpetrators.length ? "review" : "warning"} />
                    <ChevronDown className={`h-5 w-5 text-[#5f7191] transition ${prosecutionOpen ? "rotate-180" : ""}`} />
                  </span>
                </button>
                {prosecutionOpen && (
                  <div className="border-t border-[#d8dee8] p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div className="w-full sm:max-w-sm"><Field label="Perpetrator known" required><select className={inputClass} value={form.alleged_perpetrator_known} disabled={fieldsLocked} onChange={(e) => setValue("alleged_perpetrator_known", e.target.value)} required><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field></div>
                      {form.alleged_perpetrator_known === "Yes" && !fieldsLocked && <button type="button" className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-[#008c7a] px-5 text-sm font-bold text-white" onClick={openAddAccusedModal}><Plus className="h-4 w-4" />Add accused person</button>}
                    </div>
                    {form.alleged_perpetrator_known === "Yes" && (
                      <div className="mt-3">
                        <AllegedPerpetratorTable records={allegedPerpetrators} onEdit={fieldsLocked ? undefined : openEditAccusedModal} onRemove={fieldsLocked ? undefined : removeAccusedPerson} />
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === "background" && (
            <div className="space-y-5">
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-[#263747]">Previous Contacts</h3>
                    <div className="mt-1 text-sm text-[#64748b]">Record any previous contact and the reason for each service area.</div>
                  </div>
                  {fieldsLocked ? (
                    <span role="button" tabIndex={0} className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={() => setSavedMessage("This intake is locked. Click Request Update to edit previous contacts.")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSavedMessage("This intake is locked. Click Request Update to edit previous contacts.") }}><Plus className="h-4 w-4" /> Add Previous Contacts</span>
                  ) : (
                    <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={addPriorAssistance}><Plus className="h-4 w-4" /> Add Previous Contacts</button>
                  )}
                </div>
                <div className="overflow-x-auto rounded-md border border-[#d8dee8]">
                  <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                    <thead className="bg-[#f8fafc] text-[#2e6fa3]">
                      <tr>{["Previous contact", "Response", "Reason", "Action"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr>
                    </thead>
                    <tbody>
                      {previousContactDefinitions.filter(({ key }) => Boolean(form.previous_contacts[key].has_contact)).map(({ key, label }) => { const contact = form.previous_contacts[key]; return <tr key={key} className="bg-white hover:bg-[#f8fafc]"><td className="border-b border-[#edf0f4] px-4 py-3 font-bold text-[#263747]">{label}</td><td className="border-b border-[#edf0f4] px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${contact.has_contact === "Yes" ? "bg-[#fff4d6] text-[#a05b16]" : "bg-[#e7f6f3] text-[#007464]"}`}>{contact.has_contact}</span></td><td className="border-b border-[#edf0f4] px-4 py-3 whitespace-pre-wrap text-[#50617a]">{contact.reason || "No reason recorded."}</td><td className="w-24 border-b border-[#edf0f4] px-4 py-3"><button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#2e6fa3] hover:border-[#008c7a] hover:text-[#008c7a] disabled:cursor-not-allowed disabled:opacity-45" title={`Edit ${label} contact`} disabled={fieldsLocked} onClick={() => editPriorAssistance(key)}><PencilLine className="h-4 w-4" /></button></td></tr> })}
                      {!previousContactDefinitions.some(({ key }) => form.previous_contacts[key].has_contact) && <tr><td className="px-4 py-10 text-center text-[#64748b]" colSpan={4}>No previous contacts captured yet. Use Add Previous Contacts to record them.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <Field label="Other Background Information" required={false}>
                  <textarea className={`${inputClass} min-h-[150px] py-3`} value={form.child_story_or_reported_circumstances} onChange={(e) => setValue("child_story_or_reported_circumstances", e.target.value)} />
                </Field>
              </section>
            </div>
          )}

          {activeTab === "screening" && (
            <div className="space-y-5">
              <div className="min-w-0 space-y-5">
                <section className="min-w-0 rounded-md border border-[#d8dee8] bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-bold text-[#263747]">Officer &amp; Informant Details</h3>
                  <div className="mt-5 border-t border-[#edf0f4] pt-5">
                    <h4 className="mb-5 text-sm font-bold uppercase tracking-wide text-[#2e6fa3]">Officer Details</h4>
                    <SummaryFieldGrid items={[
                      ["Officer user ID", form.officer_user_id], ["Officer surname", form.officer_surname], ["Officer first names", form.officer_first_names], ["Officer designation", form.officer_designation], ["Officer district", form.officer_district], ["Officer contact", form.officer_contact],
                    ]} />
                  </div>
                  <div className="mt-7 border-t border-[#d8dee8] pt-5">
                    <h4 className="mb-5 text-sm font-bold uppercase tracking-wide text-[#2e6fa3]">Informant Details</h4>
                    <SummaryFieldGrid items={[
                      ["Surname", form.informant_surname], ["First names", form.informant_first_names], ["National ID", form.informant_id_number], ["Sex", form.informant_sex], ["Relationship to child", form.informant_relationship_to_child], ["Telephone", form.informant_phone], ["Email", form.informant_email], ["Address", form.informant_address], ["Organisation", form.informant_organization],
                    ]} />
                  </div>
                </section>

                <section className="min-w-0 rounded-md border border-[#d8dee8] bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-bold text-[#263747]">Child Details</h3>
                  <div className="mt-5 border-t border-[#edf0f4] pt-5">
                    <SummaryFieldGrid items={[
                      ["Child known", form.child_known], ["Surname", form.child_surname], ["First names", form.child_first_names], ["National ID", form.child_id_number], ["Sex", form.child_sex], ["Date of birth", form.child_date_of_birth], ["Age", form.child_age], ["Birth registered", form.birth_registered], ["Disability status", form.disability_status], ["Disability description", form.disability_description], ["Contact details", form.child_contact_details], ["Home language", form.home_language], ["Religion", form.religion], ["Race", form.child_race], ["District", form.district], ["Ward", form.ward], ["Village", form.village], ["Chief name", form.chief_name], ["Address of child", form.child_address], ["Date of referral", form.referral_date], ["Case referred by", form.case_referred_by], ["Nearest landmark", form.nearest_landmark], ["Reasons for intended inquiry", form.reasons_for_intended_inquiry],
                    ]} />
                  </div>
                </section>

                <section className="min-w-0 rounded-md border border-[#d8dee8] bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-bold text-[#263747]">Family Details</h3>
                  <div className="mt-5 max-w-full overflow-x-auto rounded-md border border-[#d8dee8]">
                    <table className="w-full min-w-[1450px] border-collapse text-left text-sm">
                      <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Category", "Type", "Name", "National ID", "Date of birth", "Age", "Occupation", "Employer", "Telephone", "Address", "Living status", "Wives / names"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3 font-bold">{head}</th>)}</tr></thead>
                      <tbody>
                        {guardians.length ? guardians.map((member, index) => <tr key={`${member.id_number}-${member.telephone}-${index}`} className="bg-white"><td className="border-b border-[#edf0f4] px-3 py-3">{member.person_category || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3 font-semibold text-[#263747]">{familyMemberType(member) || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{familyMemberName(member) || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.id_number || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.date_of_birth || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.estimated_age || member.dob_or_age || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.occupation || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.employer || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.telephone || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.address || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.living_involvement_status || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{[member.number_of_wives, member.order_of_wife].filter(Boolean).join(" / ") || "-"}</td></tr>) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={12}>No family members captured yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-6 border-t border-[#edf0f4] pt-5"><SummaryFieldGrid items={[["Circumstances of parents / caregiving", form.caregiving_circumstances]]} /></div>
                </section>

                <section className={`min-w-0 rounded-md border bg-white p-6 shadow-sm ${!form.selected_categories.length ? "border-[#e57373] ring-2 ring-[#fee4e2]" : "border-[#d8dee8]"}`}>
                  <h3 className="text-lg font-bold text-[#263747]">Case Type &amp; Safeguarding Classification</h3>
                  {!form.selected_categories.length && <div role="alert" className="mt-4 rounded-md border border-[#f4b4ac] bg-[#fff7f5] px-4 py-3 text-sm font-bold text-[#b42318]">Case type is required. Go to Case Summary and select at least one case type before submitting this case.</div>}
                  <div className="mt-5 border-t border-[#edf0f4] pt-5"><SummaryFieldGrid items={[["Selected case types", form.selected_categories], ["Juvenile delinquency offences", form.juvenile_offences], ["Other property offence", form.juvenile_other_property_offence], ["Safeguarding classification", safeguardingState.classification.replace(/_/g, " ")], ["Classification triggers", safeguardingState.triggerLabels], ["Perpetrator known", form.alleged_perpetrator_known], ["Accused name", form.accused_name], ["Accused relationship to child", form.accused_relationship_to_child], ["Accused sex", form.accused_sex], ["Accused race", form.accused_race], ["Referred to police", form.referred_to_police], ["Police referral date", form.police_referral_date], ["Court appearance scheduled", form.court_appearance_scheduled], ["Court appearance date", form.court_appearance_date], ["Conviction determined", form.conviction_determined], ["Conviction date", form.conviction_date], ["Circumstances of offence", form.circumstances_of_offence]]} /></div>
                </section>

                <section className="min-w-0 rounded-md border border-[#d8dee8] bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-bold text-[#263747]">Background Information</h3>
                  <div className="mt-5 max-w-full overflow-x-auto rounded-md border border-[#d8dee8]"><table className="w-full min-w-[700px] border-collapse text-left text-sm"><thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Previous contact", "Response", "Reason"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-4 py-3 font-bold">{head}</th>)}</tr></thead><tbody>{previousContactDefinitions.filter(({ key }) => form.previous_contacts[key].has_contact).map(({ key, label }) => <tr key={key} className="bg-white"><td className="border-b border-[#edf0f4] px-4 py-3 font-semibold text-[#263747]">{label}</td><td className="border-b border-[#edf0f4] px-4 py-3">{form.previous_contacts[key].has_contact}</td><td className="border-b border-[#edf0f4] px-4 py-3 whitespace-pre-wrap">{form.previous_contacts[key].reason || "-"}</td></tr>)}{!previousContactDefinitions.some(({ key }) => form.previous_contacts[key].has_contact) && <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={3}>No previous contacts captured.</td></tr>}</tbody></table></div>
                  <div className="mt-6 border-t border-[#edf0f4] pt-5"><SummaryFieldGrid items={[["Other background information", form.child_story_or_reported_circumstances], ["Background organisation", form.background_organisation], ["Background services", form.background_services], ["Other background service", form.other_background_service], ["Background service notes", form.background_service_notes]]} /></div>
                </section>

                <section className="min-w-0 rounded-md border border-[#d8dee8] bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-bold text-[#263747]">Intake &amp; Report Details</h3>
                  <div className="mt-5 border-t border-[#edf0f4] pt-5"><SummaryFieldGrid items={[["Case ID", form.case_id], ["Intake number", form.intake_number], ["Intake source", intakeSourceLabel], ...(isAlertReferral ? [["Alert number", form.alert_id], ["Alert referred at", form.alert_received_at]] as Array<[string, unknown]> : []), ["Date reported", form.date_reported], ["Reporting channel", form.reporting_channel], ["Concern summary", form.concern_summary], ["Reporter narrative", form.reporter_narrative], ["Emergency reported", form.emergency_reported], ["Immediate danger reported", form.immediate_danger_reported]]} /></div>
                </section>
              </div>
            </div>
          )}
        </fieldset>

        {editRequestMode && (
          <div className="mt-6 rounded-md border border-[#b7e4d8] bg-[#f8fffd] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-[#263747]">Detected Changes</h3>
                <p className="mt-1 text-sm font-semibold text-[#64748b]">The system will submit only fields whose values changed on this tab.</p>
              </div>
              <StatusPill label={`${detectedUpdateChanges().length} field changes`} tone={detectedUpdateChanges().length ? "warning" : "draft"} />
            </div>
            <div className="mt-3 overflow-hidden rounded-md border border-[#d8dee8] bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                  <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Field", "Previous Value", "Requested Value"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
                  <tbody>
                    {detectedUpdateChanges().length ? detectedUpdateChanges().map((field) => (
                      <tr key={field.path} className="bg-white">
                        <td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]">{field.label}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3 text-[#64748b]">{field.current_value}</td>
                        <td className="border-b border-[#edf0f4] px-3 py-3 font-semibold text-[#007464]">{field.proposed_value}</td>
                      </tr>
                    )) : <tr><td className="px-3 py-6 text-center text-[#64748b]" colSpan={3}>No changed fields detected yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mt-4">
              <Field label="Reason for change" required>
                <textarea className={`${inputClass} min-h-[110px] py-3`} value={requestReason} onChange={(event) => setRequestReason(event.target.value)} placeholder="Explain why the locked intake data must be corrected." />
              </Field>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#dfe4eb] pt-4">
          <div className="text-sm font-semibold text-[#64748b]">{editRequestMode ? "Pending approval workflow" : locked ? `Locked - ${form.status.replace(/_/g, " ").toLowerCase()}` : form.intake_id && autosavedAt ? `Saved ${autosavedAt}` : ""}</div>
          <div className="flex flex-wrap gap-2">
            {editRequestMode ? (
              <>
                <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 text-sm font-semibold text-[#263747]" onClick={() => void exitUpdateRequestMode(true)}>Cancel Request</button>
                <button className="rounded-md bg-[#008c7a] px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={!detectedUpdateChanges().length || !requestReason.trim()} onClick={() => void submitUpdateRequest()}>Submit Request</button>
              </>
            ) : (
              <>
            {activeTab !== "officer" && <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 text-sm font-semibold text-[#263747]" onClick={() => void setTab(tabs[Math.max(0, tabs.findIndex(([key]) => key === activeTab) - 1)][0])}>Back</button>}
            {activeTab !== "screening" && <button className="rounded-md bg-[#008c7a] px-5 py-2 text-sm font-semibold text-white" onClick={() => void setTab(tabs[Math.min(tabs.length - 1, tabs.findIndex(([key]) => key === activeTab) + 1)][0])}>Next</button>}
            {activeTab === "screening" && !locked && (
              <>
                <button className="rounded-md bg-[#008c7a] px-5 py-2 text-sm font-semibold text-white" onClick={submitToSupervisor}>Submit to Supervisor</button>
              </>
            )}
              </>
            )}
          </div>
        </div>
      </Panel>

      {showAccusedModal && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-[#0f172a]/50 p-4" role="dialog" aria-modal="true" aria-labelledby="accused-modal-title">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#dfe4eb] bg-white px-6 py-4">
              <div><h3 id="accused-modal-title" className="text-lg font-bold text-[#263747]">{editingAccusedIndex === null ? "Add accused person" : "Edit accused person"}</h3><p className="mt-1 text-sm text-[#64748b]">Capture this person separately so every alleged perpetrator has a complete record.</p></div>
              <button type="button" className="rounded-md border border-[#d8dee8] px-3 py-2 text-sm font-semibold text-[#263747]" onClick={closeAccusedModal}>Close</button>
            </div>
            <div className="space-y-5 p-6">
              <FormGrid>
                <Field label="Accused name" required><input className={inputClass} value={accusedDraft.name} onChange={(e) => updateAccusedDraft("name", e.target.value)} placeholder="Enter full name" autoFocus /></Field>
                <Field label="Relationship to child"><select className={inputClass} value={accusedDraft.relationship_to_child} onChange={(event) => updateAccusedDraft("relationship_to_child", event.target.value)}><option value="">Select relationship</option><option>Father</option><option>Mother</option><option>Other guardian</option><option>Other</option></select></Field>
                <Field label="Accused sex"><select className={inputClass} value={accusedDraft.sex} onChange={(e) => updateAccusedDraft("sex", e.target.value)}><option value="">Select sex</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="UNKNOWN">Unknown</option></select></Field>
                <Field label="Race"><select className={inputClass} value={accusedDraft.race} onChange={(e) => updateAccusedDraft("race", e.target.value)}><option value="">Select race</option><option value="BLACK">Black</option><option value="WHITE">White</option><option value="COLOURED">Coloured</option><option value="OTHER">Other</option><option value="UNKNOWN">Unknown</option></select></Field>
                <Field label="Referred to police"><select className={inputClass} value={accusedDraft.referred_to_police} onChange={(e) => updateAccusedDraft("referred_to_police", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                {accusedDraft.referred_to_police === "Yes" && <Field label="Police referral date"><input type="date" className={inputClass} value={accusedDraft.police_referral_date} onChange={(e) => updateAccusedDraft("police_referral_date", e.target.value)} /></Field>}
                <Field label="Court appearance scheduled"><select className={inputClass} value={accusedDraft.court_appearance_scheduled} onChange={(e) => updateAccusedDraft("court_appearance_scheduled", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                {accusedDraft.court_appearance_scheduled === "Yes" && <Field label="Court appearance date"><input type="date" className={inputClass} value={accusedDraft.court_appearance_date} onChange={(e) => updateAccusedDraft("court_appearance_date", e.target.value)} /></Field>}
                <Field label="Conviction determined"><select className={inputClass} value={accusedDraft.conviction_determined} onChange={(e) => updateAccusedDraft("conviction_determined", e.target.value)}><option value="">Select</option><option>Yes</option><option>No</option><option>Unknown</option></select></Field>
                {accusedDraft.conviction_determined === "Yes" && <Field label="Conviction date"><input type="date" className={inputClass} value={accusedDraft.conviction_date} onChange={(e) => updateAccusedDraft("conviction_date", e.target.value)} /></Field>}
              </FormGrid>
              <Field label="Circumstances of offence"><textarea className={`${inputClass} min-h-[120px] py-3`} value={accusedDraft.circumstances_of_offence} onChange={(e) => updateAccusedDraft("circumstances_of_offence", e.target.value)} placeholder="Record relevant circumstances for this accused person." /></Field>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-[#dfe4eb] bg-[#f8fafc] px-6 py-4"><button type="button" className="rounded-md border border-[#d8dee8] bg-white px-5 py-2.5 text-sm font-semibold text-[#263747]" onClick={closeAccusedModal}>Cancel</button><button type="button" className="rounded-md bg-[#008c7a] px-5 py-2.5 text-sm font-bold text-white" onClick={saveAccusedPerson}>{editingAccusedIndex === null ? "Add accused person" : "Save changes"}</button></div>
          </div>
        </div>
      )}

      {showGuardianModal && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-[#0f172a]/45 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-md bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-[#dfe4eb] pb-3">
              <h3 className="text-lg font-bold text-[#263747]">{editingGuardianIndex === null ? "Add Family Member" : "Edit Family Member"}</h3>
              <button className="rounded-md border border-[#d8dee8] px-3 py-1 font-semibold" onClick={closeGuardianModal}>Close</button>
            </div>
            <FormGrid>
              <Field label="Person category" required><select className={inputClass} value={guardianDraft.person_category} onChange={(e) => updateGuardianDraft({ person_category: e.target.value })}><option value="">Select person category</option>{familyPersonCategories.map((item) => <option key={item}>{item}</option>)}</select></Field>

              {guardianDraft.person_category === "Parent / Guardian" && <>
                <Field label="Family member type" required><select className={inputClass} value={guardianDraft.family_member_type || guardianDraft.guardian_type} onChange={(e) => updateGuardianDraft({ family_member_type: e.target.value, guardian_type: e.target.value })}><option value="">Select family member type</option>{parentGuardianTypes.map((item) => <option key={item}>{item}</option>)}</select></Field>
                {showsWifeDetails(guardianDraft.family_member_type || guardianDraft.guardian_type) && <>
                  <Field label="Number of wives"><input className={inputClass} type="number" min="1" step="1" value={guardianDraft.number_of_wives} onChange={(e) => updateGuardianDraft({ number_of_wives: e.target.value.replace(/[^\d]/g, "") })} /></Field>
                  <Field label="Order of wives"><input className={inputClass} value={guardianDraft.order_of_wife} onChange={(e) => updateGuardianDraft({ order_of_wife: e.target.value })} /></Field>
                </>}
                <Field label="Surname"><input className={inputClass} value={guardianDraft.surname} onChange={(e) => updateGuardianDraft({ surname: e.target.value })} /></Field>
                <Field label="First names"><input className={inputClass} value={guardianDraft.first_names} onChange={(e) => updateGuardianDraft({ first_names: e.target.value })} /></Field>
                <Field label="ID number"><input className={inputClass} value={guardianDraft.id_number} onChange={(e) => updateGuardianDraft({ id_number: e.target.value })} /></Field>
                {familyMemberDobFields()}
                <Field label="Occupation"><input className={inputClass} value={guardianDraft.occupation} onChange={(e) => updateGuardianDraft({ occupation: e.target.value })} /></Field>
                <Field label="Employer"><input className={inputClass} value={guardianDraft.employer} onChange={(e) => updateGuardianDraft({ employer: e.target.value })} /></Field>
                <Field label="Telephone" required={false}><input className={inputClass} value={guardianDraft.telephone} onChange={(e) => updateGuardianDraft({ telephone: e.target.value })} /></Field>
                <Field label="Address" required={false}><input className={inputClass} value={guardianDraft.address} onChange={(e) => updateGuardianDraft({ address: e.target.value })} /></Field>
                <Field label="Living status"><select className={inputClass} value={guardianDraft.living_involvement_status} onChange={(e) => updateGuardianDraft({ living_involvement_status: e.target.value })}><option value="">Select status</option>{involvementStatuses.map((item) => <option key={item}>{item}</option>)}</select></Field>
                {guardianDraft.living_involvement_status === "Deceased" && <Field label="Date deceased"><input className={inputClass} type="date" value={guardianDraft.date_deceased} onChange={(e) => updateGuardianDraft({ date_deceased: e.target.value })} /></Field>}
                {guardianDraft.living_involvement_status === "Abandoned" && <Field label="Date abandoned"><input className={inputClass} type="date" value={guardianDraft.date_abandoned} onChange={(e) => updateGuardianDraft({ date_abandoned: e.target.value })} /></Field>}
              </>}

              {guardianDraft.person_category === "Sibling" && <>
                <Field label="First names"><input className={inputClass} value={guardianDraft.first_names} onChange={(e) => updateGuardianDraft({ first_names: e.target.value, name: [e.target.value, guardianDraft.surname].filter(Boolean).join(" ") })} /></Field>
                <Field label="Surname"><input className={inputClass} value={guardianDraft.surname} onChange={(e) => updateGuardianDraft({ surname: e.target.value, name: [guardianDraft.first_names, e.target.value].filter(Boolean).join(" ") })} /></Field>
                {familyMemberDobFields()}
                <Field label="Gender"><select className={inputClass} value={guardianDraft.gender} onChange={(e) => updateGuardianDraft({ gender: e.target.value })}><option value="">Select gender</option><option>Female</option><option>Male</option><option>Unknown</option></select></Field>
                <Field label="Family member type"><select className={inputClass} value={guardianDraft.family_member_type} onChange={(e) => updateGuardianDraft({ family_member_type: e.target.value })}><option value="">Select family member type</option>{siblingTypes.map((item) => <option key={item}>{item}</option>)}</select></Field>
                <div className="md:col-span-2"><Field label="Remarks"><textarea className={`${inputClass} min-h-[90px] py-3`} value={guardianDraft.remarks} onChange={(e) => updateGuardianDraft({ remarks: e.target.value })} /></Field></div>
              </>}

              {guardianDraft.person_category === "Significant Other" && <>
                <Field label="Relationship to child" required><RelationshipSelect value={guardianDraft.relationship_to_child} onChange={(value) => updateGuardianDraft({ relationship_to_child: value })} relationshipTypes={relationshipTypes} /></Field>
                <Field label="First names"><input className={inputClass} value={guardianDraft.first_names} onChange={(e) => updateGuardianDraft({ first_names: e.target.value, name: [e.target.value, guardianDraft.surname].filter(Boolean).join(" ") })} /></Field>
                <Field label="Surname"><input className={inputClass} value={guardianDraft.surname} onChange={(e) => updateGuardianDraft({ surname: e.target.value, name: [guardianDraft.first_names, e.target.value].filter(Boolean).join(" ") })} /></Field>
                {familyMemberDobFields()}
                <div className="md:col-span-2"><Field label="Remarks"><textarea className={`${inputClass} min-h-[90px] py-3`} value={guardianDraft.remarks} onChange={(e) => updateGuardianDraft({ remarks: e.target.value })} /></Field></div>
              </>}
            </FormGrid>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-md border border-[#d8dee8] px-4 py-2 font-semibold" onClick={closeGuardianModal}>Cancel</button>
              <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={saveGuardian}>{editingGuardianIndex === null ? "Save family member" : "Update family member"}</button>
            </div>
          </div>
        </div>
      )}

      {showPriorAssistanceModal && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-[#0f172a]/45 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-md bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-[#dfe4eb] pb-3">
              <div>
                <h3 className="text-lg font-bold text-[#263747]">{editingPreviousContact ? `Edit ${previousContactDefinitions.find((item) => item.key === editingPreviousContact)?.label} Contact` : "Add Previous Contacts"}</h3>
                <p className="mt-1 text-sm font-semibold text-[#64748b]">Select Yes or No for each contact. A reason is required whenever Yes is selected.</p>
              </div>
              <button className="rounded-md border border-[#d8dee8] px-3 py-1 font-semibold" onClick={closePriorAssistanceModal}>Close</button>
            </div>
            <div className="space-y-4">
              {previousContactDefinitions.filter(({ key }) => !editingPreviousContact || key === editingPreviousContact).map(({ key, label, question, reasonLabel }) => <section key={key} className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4"><div className="mb-3 font-bold text-[#263747]">{label}</div><Field label={question} required><select className={inputClass} value={priorAssistanceDraft[key].has_contact} onChange={(event) => updatePreviousContactDraft(key, "has_contact", event.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>{priorAssistanceDraft[key].has_contact === "Yes" && <div className="mt-3"><Field label={reasonLabel} required><textarea className={`${inputClass} min-h-[100px] py-3`} value={priorAssistanceDraft[key].reason} onChange={(event) => updatePreviousContactDraft(key, "reason", event.target.value)} placeholder="Describe the reason for the previous contact." /></Field></div>}</section>)}
            </div>
            <div className="mt-5 flex justify-end gap-2 border-t border-[#dfe4eb] pt-4">
              <button className="rounded-md border border-[#d8dee8] px-4 py-2 font-semibold" onClick={closePriorAssistanceModal}>Cancel</button>
              <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={savePriorAssistance}>{editingPreviousContact ? "Update contact" : "Save contacts"}</button>
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
      {updateRequestDialog && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="w-full max-w-md rounded-md border border-[#cfe4df] bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#e7f6f3] text-[#008c7a]">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-xl font-bold text-[#263747]">{updateRequestDialog.title}</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7191]">{updateRequestDialog.detail}</p>
            <button className="mt-6 h-11 rounded-md bg-[#008c7a] px-8 font-semibold text-white hover:bg-[#007767]" onClick={() => setUpdateRequestDialog(null)}>OK</button>
          </div>
        </div>
      )}
    </div>
  )
}

function CaseTypeGroup({ title, items, selected, onToggle, readOnly = false }: { title: string; items: string[]; selected: string[]; onToggle: (item: string) => void; readOnly?: boolean }) {
  return (
    <section className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
      <h3 className="mb-3 text-sm font-bold uppercase text-[#2e6fa3]">{title}</h3>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <label key={item} className={`flex min-h-11 items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm font-semibold ${selected.includes(item) ? "border-[#008c7a] text-[#007464] ring-2 ring-[#008c7a]/10" : "border-[#d8dee8] text-[#263747]"}`}>
            <input type="checkbox" className="h-4 w-4 accent-[#008c7a] disabled:cursor-not-allowed" checked={selected.includes(item)} disabled={readOnly} onChange={() => onToggle(item)} />
            <span>{item}</span>
          </label>
        ))}
      </div>
    </section>
  )
}

function ConcernAccordion({ title, selectedCount, open, onToggle, children }: { title: string; selectedCount: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-md border border-[#d8dee8] bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 bg-[#f8fafc] px-4 py-4 text-left hover:bg-[#f1f5f9]"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block text-sm font-bold uppercase text-[#2e6fa3]">{title}</span>
          {selectedCount > 0 && <span className="mt-1 block text-xs font-semibold text-[#007464]">{selectedCount} selected</span>}
        </span>
        <span className="inline-flex shrink-0 items-center gap-2">
          {selectedCount > 0 && <span className="rounded-full bg-[#e7f6f3] px-3 py-1 text-xs font-bold text-[#007464]">{selectedCount}</span>}
          <ChevronDown className={`h-5 w-5 text-[#5f7191] transition ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && <div className="border-t border-[#d8dee8] p-4">{children}</div>}
    </section>
  )
}

function CaseTypeSection({ title, subtitle, sections, selected, onToggle, readOnly = false }: { title: string; subtitle?: string; sections: Array<{ title: string; items: string[] }>; selected: string[]; onToggle: (item: string) => void; readOnly?: boolean }) {
  return (
    <section className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
      <div className="mb-4">
        <h3 className="text-sm font-bold uppercase text-[#2e6fa3]">{title}</h3>
        {subtitle && <p className="mt-1 text-sm font-semibold text-[#64748b]">{subtitle}</p>}
      </div>
      <div className="space-y-3">
        {sections.map((section) => (
          <div key={section.title} className="rounded-md border border-[#d8dee8] bg-white p-3">
            <h4 className="mb-2 text-sm font-extrabold text-[#263747]">{section.title}</h4>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {section.items.map((item) => (
                <label key={item} className={`flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${selected.includes(item) ? "border-[#008c7a] bg-[#e7f6f3] text-[#007464]" : "border-[#edf0f4] bg-[#fbfdff] text-[#263747]"}`}>
                  <input type="checkbox" className="h-4 w-4 accent-[#008c7a] disabled:cursor-not-allowed" checked={selected.includes(item)} disabled={readOnly} onChange={() => onToggle(item)} />
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


function EmergencyBadge({ label }: { label: string }) {
  const immediate = label === "IMMEDIATE DANGER"
  if (!label) return null
  const style = immediate ? "border-[#b42318] bg-[#fee4e2] text-[#b42318]" : label === "EMERGENCY" ? "border-[#f97316] bg-[#fff4d6] text-[#a05b16]" : "border-[#d8dee8] bg-[#f1f5f9] text-[#64748b]"
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-normal ${style}`}>{label}</span>
}

function EmergencyWarningPanel({ immediate }: { immediate: boolean }) {
  return (
    <div className={`rounded-md border px-4 py-3 text-sm font-semibold leading-6 ${immediate ? "border-[#f4b4ac] bg-[#fff7f5] text-[#9f1239]" : "border-[#f3d38b] bg-[#fffaf0] text-[#8a5b00]"}`}>
      {immediate
        ? "The child has been identified as being in immediate danger. Immediate safeguarding action is required."
        : "This case has been identified as an emergency and requires urgent attention."}
    </div>
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
    const allocationSubmittedAt = sourceAlert?.submittedAt || caseRecord.screeningCompletedAt || caseRecord.submittedForReviewAt || caseRecord.createdAt
    const sla = calculateSla(allocationSubmittedAt, caseRecord.riskLevel)
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
  if (!user) return false
  if (row.allocatedOfficerId != null) return Number(row.allocatedOfficerId) === Number(user.id)
  if (!row.allocatedOfficer) return false
  const assignedOfficer = row.allocatedOfficer.toLowerCase()
  const fullName = `${user.first_name} ${user.last_name}`.trim()
  const initialName = user.last_name ? `${user.first_name.charAt(0)}. ${user.last_name}`.trim() : ""
  return [user.username, user.email, fullName, initialName]
    .filter(Boolean)
    .some((candidate) => assignedOfficer.includes(candidate.toLowerCase()))
}

function provinceNameForCase(row: Pick<CaseRecord, "district">, districts: DistrictOption[]) {
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

function tabHasCapturedData(tab: string, form: Record<string, unknown>, guardians: FamilyMemberDraft[]) {
  if (tab === "officer") return Boolean(form.officer_surname || form.informant_surname || form.informant_first_names)
  if (tab === "child") return Boolean(form.child_surname || form.child_first_names || form.child_age)
  if (tab === "family") return guardians.length > 0 || Boolean(form.caregiving_circumstances)
  if (tab === "case") return Array.isArray(form.selected_categories) && form.selected_categories.length > 0
  if (tab === "background") return Boolean(form.child_story_or_reported_circumstances || previousContactDefinitions.some(({ key }) => objectValue(form.previous_contacts)[key] && objectValue(objectValue(form.previous_contacts)[key]).has_contact))
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
    const districtCode = districtCodeFromName(draft.district, districts) || draft.district.slice(0, 2).toUpperCase()
    const caseNumber = `${cases.length + 1}`.padStart(4, "0")
    onSave({
      id: `${districtCode}/${new Date().getFullYear()}/${caseNumber}`,
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
        <Field label="Concern"><select className={inputClass} value={draft.concern} onChange={(event) => setDraft({ ...draft, concern: event.target.value })}><option value="">Select concern</option>{allCaseTypeOptions.map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="District"><input className={inputClass} type="text" value={draft.district} onChange={(event) => setDraft({ ...draft, district: event.target.value })} placeholder="Enter district" /></Field>
        <Field label="Ward number"><input className={inputClass} type="text" inputMode="numeric" pattern="[0-9]*" value={draft.ward} onChange={(event) => setDraft({ ...draft, ward: event.target.value.replace(/[^0-9]/g, "") })} placeholder="Enter ward number" /></Field>
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
          <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={convert}>Convert to Intake</button>
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
      <button className="mt-5 rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={submitScreening}>Submit case for allocation</button>
    </Panel>
  )
}

type DistrictHeadQueueMode = "unallocated" | "allocated" | "attention" | "priority"

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
  openCaseId,
  onOpenedCaseHandled,
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
  openCaseId?: string
  onOpenedCaseHandled?: () => void
}) {
  const isDistrictHead = user?.profile.role === "DISTRICT_HEAD"
  const isProvincialHead = user?.profile.role === "PROVINCIAL_HEAD"
  const isNationalUser = Boolean(user && ["SYS_ADMIN", "DEPUTY_DIRECTOR", "DIRECTOR", "PROGRAMME_OFFICER"].includes(user.profile.role))
  const rows = buildDistrictHeadRows(alerts, cases)
  const unallocatedRows = rows.filter((row) => ["Pending Supervisor Review", "Approved for Allocation"].includes(row.status))
  const allocatedRows = rows.filter((row) => row.status === "Allocated")
  const userAllocatedRows = allocatedRows.filter((row) => allocatedRowVisibleToUser(row, user, users, districts))
  const priorityAllocatedRows = userAllocatedRows.filter((row) => isEmergencyCaseRecord(row) || ["HIGH", "CRITICAL"].includes(row.riskLevel.toUpperCase()))
  const attentionReasonsByCaseId = new Map<string, string[]>()
  cases.forEach((caseRecord) => {
    if (isEmptyManualPlaceholder(caseRecord)) return false
    const isEmergency = isEmergencyCaseRecord(caseRecord) && caseRecord.status !== "Allocated"
    const isImmediateDanger = isImmediateDangerCaseRecord(caseRecord) && caseRecord.status !== "Allocated"
    const isHighRisk = ["HIGH", "CRITICAL"].includes(caseRecord.riskLevel.toUpperCase())
    const assessmentOverdue = caseRecord.assessmentSlaStatus === "Overdue" || Boolean(caseRecord.assessmentDueAt && new Date(caseRecord.assessmentDueAt).getTime() < Date.now() && !caseRecord.assessmentCompletedAt)
    const carePlanComplete = ["Submitted", "Approved", "Approved with Comments"].includes(caseRecord.assessmentCarePlanStatus || "")
    const carePlanOverdue = Boolean(caseRecord.assessmentCompletedAt) && !carePlanComplete && Date.now() - new Date(caseRecord.assessmentCompletedAt || "").getTime() > 7 * 24 * 60 * 60 * 1000
    const monitoringOverdue = Array.isArray(caseRecord.intakeDraft?.monitoring_followups_draft) && caseRecord.intakeDraft.monitoring_followups_draft.some((record) => {
      const followUpDate = textValue((record as Record<string, unknown>).nextFollowUpDate) || textValue((record as Record<string, unknown>).next_follow_up_date)
      return Boolean(followUpDate) && new Date(followUpDate).getTime() < Date.now()
    })
    const reasons = [
      ...(isEmergency ? ["Emergency response needed"] : []),
      ...(isImmediateDanger ? ["Immediate danger reported"] : []),
      ...(isHighRisk ? [`${caseRecord.riskLevel.charAt(0)}${caseRecord.riskLevel.slice(1).toLowerCase()} risk`] : []),
      ...(assessmentOverdue ? ["Assessment overdue"] : []),
      ...(carePlanOverdue ? ["Care plan overdue"] : []),
      ...(monitoringOverdue ? ["Monitoring follow-up overdue"] : []),
    ]
    if (reasons.length) attentionReasonsByCaseId.set(caseRecord.id, reasons)
  })
  const attentionRows = rows.filter((row) => attentionReasonsByCaseId.has(row.id) && (!isDistrictHead || !user?.profile.districtName || row.district === user.profile.districtName))
  const allocatedScopeLabel = isNationalUser ? "National allocated cases" : isProvincialHead ? "Provincial allocated cases" : isDistrictHead ? "District allocated cases" : "My allocated cases"
  const visibleRows = mode === "unallocated" ? unallocatedRows : mode === "attention" ? attentionRows : mode === "priority" ? priorityAllocatedRows : userAllocatedRows
  const isAllocatedListMode = mode === "allocated" || mode === "priority"
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
  const [caseFiltersOpen, setCaseFiltersOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const districtCaseWorkers = users.filter((item) => item.profile.role === "DSDO" && (!isDistrictHead || !user?.profile.districtName || item.profile.districtName === user.profile.districtName))
  const officerOptions = districtCaseWorkers.map((item) => `${item.id}|${item.username} - ${item.profile.roleLabel}`)
  const [allocatedOfficer, setAllocatedOfficer] = useState(officerOptions[0] || "")
  const selected = rows.find((row) => row.id === selectedCaseId) || visibleRows[0] || rows[0]
  const caseSearchText = searchTerm.trim().toLowerCase()
  const matchesCaseFilters = (row: DistrictHeadCaseRow, useWorkflowStatus = false) => {
    const statusValue = useWorkflowStatus ? allocatedWorkflowStatus(row) : row.status
    const officerValue = row.allocatedOfficer || "Unassigned"
    const matchesSearch = !caseSearchText || [row.id, row.childName, row.district, row.ward, row.concern, row.intakeOfficer || "", officerValue, allocatedOfficerName(row, users), districtHeadName(row, users), provinceNameForCase(row, districts)].some((value) => value.toLowerCase().includes(caseSearchText))
    return matchesSearch
      && (statusFilter === "All" || statusValue === statusFilter)
      && (riskFilter === "All" || row.riskLevel.toUpperCase() === riskFilter.toUpperCase())
      && (districtFilter === "All" || row.district === districtFilter)
      && (categoryFilter === "All" || row.concern === categoryFilter)
      && (officerFilter === "All" || officerValue === officerFilter)
  }
  const allocatedListRows = visibleRows.filter((row) => matchesCaseFilters(row, true))
  const queueListRows = visibleRows.filter((row) => matchesCaseFilters(row))
  const allocatedDistricts = Array.from(new Set(userAllocatedRows.map((row) => row.district))).sort()
  const allocatedCategories = Array.from(new Set(userAllocatedRows.map((row) => row.concern))).sort()
  const allocatedOfficers = Array.from(new Set(userAllocatedRows.map((row) => row.allocatedOfficer || "Unassigned"))).sort()
  const allocatedStatuses = ["All", ...Array.from(new Set(userAllocatedRows.map(allocatedWorkflowStatus))).sort()]
  const queueDistricts = Array.from(new Set(visibleRows.map((row) => row.district))).sort()
  const queueCategories = Array.from(new Set(visibleRows.map((row) => row.concern))).sort()
  const queueOfficers = Array.from(new Set(visibleRows.map((row) => row.allocatedOfficer || "Unassigned"))).sort()
  const queueStatuses = ["All", ...Array.from(new Set(visibleRows.map((row) => row.status))).sort()]
  const allocatedFilterOptions = [
    { key: "status", label: "Current status", value: statusFilter, setValue: setStatusFilter, options: allocatedStatuses },
    { key: "risk", label: "Risk level", value: riskFilter, setValue: setRiskFilter, options: ["All", "Low", "Medium", "High", "Critical"] },
    { key: "district", label: "District", value: districtFilter, setValue: setDistrictFilter, options: ["All", ...allocatedDistricts] },
    { key: "category", label: "Primary case category", value: categoryFilter, setValue: setCategoryFilter, options: ["All", ...allocatedCategories] },
    { key: "officer", label: "Assigned officer", value: officerFilter, setValue: setOfficerFilter, options: ["All", ...allocatedOfficers] },
  ] as const
  const queueFilterOptions = [
    { key: "status", label: "Current status", value: statusFilter, setValue: setStatusFilter, options: queueStatuses },
    { key: "risk", label: "Risk level", value: riskFilter, setValue: setRiskFilter, options: ["All", "Low", "Medium", "High", "Critical"] },
    { key: "district", label: "District", value: districtFilter, setValue: setDistrictFilter, options: ["All", ...queueDistricts] },
    { key: "category", label: "Primary case category", value: categoryFilter, setValue: setCategoryFilter, options: ["All", ...queueCategories] },
    { key: "officer", label: "Assigned officer", value: officerFilter, setValue: setOfficerFilter, options: ["All", ...queueOfficers] },
  ] as const
  const currentFilterOptions = isAllocatedListMode ? allocatedFilterOptions : queueFilterOptions
  const filteredCaseRows = isAllocatedListMode ? allocatedListRows : queueListRows
  const activeAllocatedFilters = currentFilterOptions.filter((filter) => filter.value !== "All")
  const pageCount = Math.max(1, Math.ceil(filteredCaseRows.length / rowsPerPage))
  const safePage = Math.min(page, pageCount)
  const pagedCaseRows = filteredCaseRows.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage)
  const pageStart = filteredCaseRows.length ? (safePage - 1) * rowsPerPage + 1 : 0
  const pageEnd = Math.min(filteredCaseRows.length, safePage * rowsPerPage)
  function clearAllocatedFilters() {
    setStatusFilter("All")
    setRiskFilter("All")
    setDistrictFilter("All")
    setCategoryFilter("All")
    setOfficerFilter("All")
  }

  function renderCaseFilterPanel() {
    return (
      <div className="mt-3 border-t border-[#d8dee8] pt-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(5,minmax(150px,1fr))_auto]">
          {currentFilterOptions.map((filter) => (
            <label key={filter.key} className="grid gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-[#64748b]">{filter.label}</span>
              <select className={`${inputClass} h-10 min-w-0 font-semibold`} value={filter.value} onChange={(event) => filter.setValue(event.target.value)}>
                {filter.options.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
          ))}
          <div className="flex items-end">
            <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#d8dee8] bg-white px-3 text-sm font-bold text-[#263747] transition hover:border-[#008c7a] hover:text-[#008c7a]" onClick={clearAllocatedFilters}>
              <RotateCcw className="h-4 w-4" /> Clear
            </button>
          </div>
        </div>
        {activeAllocatedFilters.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {activeAllocatedFilters.map((filter) => (
              <span key={filter.key} className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[#b7e4d8] bg-white px-3 py-1 text-xs font-bold text-[#007464]">
                <span>{filter.label}: {filter.value}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  useEffect(() => setPage(1), [mode, searchTerm, statusFilter, riskFilter, districtFilter, categoryFilter, officerFilter, rowsPerPage])

  const allocatedTableHeads = [
    "Case Number",
    "Province",
    "Child Name",
    "Age",
    "Sex",
    "District",
    ...(isNationalUser || isProvincialHead ? ["DSDO"] : []),
    "Ward",
    "Primary Case Category",
    "Risk Level",
    "Workflow Stage",
    "Date Allocated",
    "Assessment Due",
    "Assessment SLA",
    "Days Since Allocation",
    "Next Action Required",
    "Assigned Officer",
    "Action",
  ]
  const queueTitle = mode === "unallocated" ? "Unallocated Cases" : mode === "attention" ? "Cases Requiring Attention" : mode === "priority" ? "My High Priority Cases" : "Allocated Cases"
  const queueDescription =
    mode === "unallocated"
      ? "Submitted cases waiting for DSDO review and SDO allocation."
      : mode === "attention"
        ? "District cases that need urgent review, including high-risk and overdue cases."
      : "Cases allocated to the logged-in user."
  const emptyMessage =
    mode === "unallocated"
      ? "No cases are waiting for allocation."
      : mode === "attention"
        ? "No cases currently require attention."
      : "No cases have been allocated to you."
  const allocatedEmptyMessage = isNationalUser
    ? "No allocated cases found nationally."
    : isProvincialHead
      ? "No allocated cases found for this province."
      : isDistrictHead
        ? "No allocated cases found for this district."
        : "No cases have been allocated to you."
  const backLabel = mode === "unallocated" ? "Back to unallocated cases" : mode === "attention" ? "Back to cases requiring attention" : "Back to allocated cases"

  useEffect(() => {
    if (!visibleRows.some((row) => row.id === selectedCaseId)) setSelectedCaseId(visibleRows[0]?.id || rows[0]?.id || "")
  }, [mode, visibleRows.length, rows.length])

  useEffect(() => {
    if (!openCaseId || mode !== "allocated") return
    const caseToOpen = visibleRows.find((row) => row.id === openCaseId)
    if (!caseToOpen) return
    setSelectedCaseId(caseToOpen.id)
    setShowDetails(true)
    setShowFactBox(false)
    onOpenedCaseHandled?.()
  }, [mode, openCaseId, onOpenedCaseHandled, visibleRows])

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
        updatedIntake = await apiPost<IntakeRecord>(`/intakes/${row.backendIntakeId}/allocate/`, {
          officer_id: officerId,
          supervisor_notes: reviewNotes,
        })
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

  if (selected && showDetails && isAllocatedListMode) {
    return <AllocatedCaseWorkspace key={`${selected.backendIntakeId || selected.id}:${selected.assessmentCarePlanStatus || "Draft"}`} row={selected} canManage={isCaseAllocatedToUser(selected, user)} onBack={() => setShowDetails(false)} onOpenFullIntake={() => openFullIntake?.(selected)} saveCalendarTasks={saveCalendarTasks} />
  }

  if (mode === "unallocated" && !isDistrictHead) {
    return <Panel title="Unallocated Cases" icon={Lock} action="DSDO only"><div className="rounded-md border border-[#d8dee8] bg-white p-6 text-sm font-semibold text-[#64748b]">Only the DSDO can view and allocate unallocated cases.</div></Panel>
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
              {reviewNotes && <div className="rounded-md border border-[#b7e4d8] bg-[#f0fdf9] p-3 text-sm font-semibold text-[#007464]">{reviewNotes}</div>}
              {mode !== "allocated" && (
                <>
                  <Field label="Review notes"><textarea className={`${inputClass} min-h-[110px] py-3`} value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} /></Field>
                  <button className="w-full rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747] disabled:opacity-50" disabled={selected.status !== "Pending Supervisor Review"} onClick={() => returnForCorrection(selected)}>Return for correction</button>
                  <div className="border-t border-[#edf0f4] pt-4">
                    <Field label="Allocate to SDO"><select className={inputClass} value={allocatedOfficer} onChange={(event) => setAllocatedOfficer(event.target.value)}><option value="">Select SDO</option>{officerOptions.map((officer) => <option key={officer} value={officer}>{officer.split("|").slice(1).join("|")}</option>)}</select></Field>
                    <button className="mt-3 w-full rounded-md bg-[#263747] px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={!['Approved for Allocation', 'Pending Supervisor Review'].includes(selected.status) || !allocatedOfficer} onClick={() => allocate(selected)}>Allocate case</button>
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

  if (isAllocatedListMode) {
    return (
      <div className="space-y-4">
        <Panel title={queueTitle} icon={mode === "priority" ? ShieldAlert : UserCheck} action={mode === "priority" ? "Emergency and high-risk cases allocated to me" : allocatedScopeLabel}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-[#64748b]">{mode === "priority" ? "Emergency and High/Critical risk cases allocated to the logged-in officer." : "View allocated cases, track assessments, and follow up on required actions."}</div>
            <div className="flex flex-wrap gap-2">
              <StatusPill label={`${visibleRows.length} allocated`} tone="review" />
              <StatusPill label={`${visibleRows.filter((row) => ["HIGH", "CRITICAL"].includes(row.riskLevel.toUpperCase())).length} high risk`} tone="warning" />
              <StatusPill label={`${visibleRows.filter((row) => !row.assessmentCompletedAt).length} assessment due`} tone="draft" />
            </div>
          </div>
          <div className="mb-4 rounded-md border border-[#d8dee8] bg-[#fbfdff] p-3">
            <div className="grid items-center gap-3 md:grid-cols-[1fr_minmax(280px,560px)_auto_auto]">
              <span className="hidden md:block" />
              <span className="relative block w-full">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
                <input className={`${inputClass} h-10 pl-9`} placeholder="Search by case, child, district, ward, category, or officer" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
              </span>
              <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#d8dee8] bg-white px-3 text-sm font-semibold text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]" onClick={() => setCaseFiltersOpen((open) => !open)}>
                <Settings className="h-4 w-4" /> Filters
                <ChevronDown className={`h-4 w-4 transition ${caseFiltersOpen ? "rotate-180" : ""}`} />
              </button>
              <span className="justify-self-start rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-bold text-[#263747] md:justify-self-end">{filteredCaseRows.length} records</span>
            </div>
            {caseFiltersOpen && renderCaseFilterPanel()}
          </div>
          <div className="overflow-hidden rounded-md border border-[#d8dee8] bg-white">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[1500px] border-collapse text-left text-sm">
              <thead className="bg-[#f8fafc] text-[#2e6fa3]">
                <tr>{allocatedTableHeads.map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-2.5">{head}</th>)}</tr>
              </thead>
              <tbody>
                {pagedCaseRows.length ? pagedCaseRows.map((row) => (
                  <tr key={row.id} className="bg-white hover:bg-[#f8fafc]">
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">
                      <button className="font-bold text-[#30528c] underline-offset-2 hover:text-[#008c7a] hover:underline" onClick={() => openCase(row)}>{row.id}</button>
                    </td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{provinceNameForCase(row, districts)}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{row.childName}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{row.age}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{row.sex}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{row.district}</td>
                    {(isNationalUser || isProvincialHead) && <td className="border-b border-[#edf0f4] px-3 py-2.5">{districtHeadName(row, users)}</td>}
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{row.ward}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{row.concern}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5"><PriorityBadge risk={row.riskLevel} /></td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5"><span className="rounded-full bg-[#e7f6f3] px-3 py-1 text-xs font-bold text-[#007464]">{allocatedWorkflowStatus(row)}</span></td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{formatWorkflowDateTime(allocatedDate(row))}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{row.assessmentDueAt ? formatWorkflowDateTime(row.assessmentDueAt) : "Pending allocation"}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5"><StatusPill label={assessmentPerformanceLabel(row)} tone={assessmentTone(row)} /></td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{daysSince(allocatedDate(row))}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{nextAllocatedAction(row)}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">{allocatedOfficerName(row, users)}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-2.5">
                      <button className="grid h-7 w-7 place-items-center rounded-full border border-[#cbd5e1] bg-white text-[#008c7a] hover:border-[#008c7a] hover:bg-[#e7f6f3]" title="Open case" onClick={() => openCase(row)}>
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={allocatedTableHeads.length}>{mode === "priority" ? "No emergency or high-risk cases are currently allocated to you." : allocatedEmptyMessage}</td></tr>}
              </tbody>
            </table>
            </div>
            <TablePagination totalRows={filteredCaseRows.length} pageStart={pageStart} pageEnd={pageEnd} rowsPerPage={rowsPerPage} setRowsPerPage={setRowsPerPage} page={safePage} pageCount={pageCount} setPage={setPage} />
          </div>
        </Panel>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Panel title={queueTitle} icon={UserCheck} action={`${filteredCaseRows.length} records`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-[#64748b]">{queueDescription}</div>
          <div className="flex flex-wrap gap-2">
            <StatusPill label={mode === "attention" ? `${attentionRows.length} requiring attention` : `${unallocatedRows.length} awaiting allocation`} tone="warning" />
          </div>
        </div>
        <div className="mb-4 rounded-md border border-[#d8dee8] bg-[#fbfdff] p-3">
          <div className="grid items-center gap-3 md:grid-cols-[1fr_minmax(280px,560px)_auto_auto]">
            <span className="hidden md:block" />
            <span className="relative block w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
              <input className={`${inputClass} h-10 pl-9`} placeholder="Search by case, child, district, ward, category, or officer" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
            </span>
            <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#d8dee8] bg-white px-3 text-sm font-semibold text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]" onClick={() => setCaseFiltersOpen((open) => !open)}>
              <Settings className="h-4 w-4" /> Filters
              <ChevronDown className={`h-4 w-4 transition ${caseFiltersOpen ? "rotate-180" : ""}`} />
            </button>
            <span className="justify-self-start rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-bold text-[#263747] md:justify-self-end">{filteredCaseRows.length} records</span>
          </div>
          {caseFiltersOpen && renderCaseFilterPanel()}
        </div>
        <div className="overflow-hidden rounded-md border border-[#d8dee8] bg-white">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[1350px] border-collapse text-left text-sm">
            <thead className="bg-[#f8fafc] text-[#2e6fa3]">
              <tr>{["Case No.", "Priority", "Allocation Wait", "Child", "Province", "District", "Case Type", "Submitted By", "Status", ...(mode === "attention" ? ["Attention Reason"] : []), "Deadline", "Assigned Officer"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-2.5">{head}</th>)}</tr>
            </thead>
            <tbody>
              {pagedCaseRows.length ? pagedCaseRows.map((row) => (
                <tr key={row.id} className={selected?.id === row.id ? "bg-[#e7f6f3]" : "bg-white hover:bg-[#f8fafc]"}>
                  <td className="border-b border-[#edf0f4] px-3 py-2.5">
                    <button className="font-bold text-[#30528c] underline-offset-2 hover:text-[#008c7a] hover:underline" onClick={() => openCase(row)}>{row.id}</button>
                  </td>
                  <td className="border-b border-[#edf0f4] px-3 py-2.5"><PriorityBadge risk={row.riskLevel} /></td>
                  <td className="border-b border-[#edf0f4] px-3 py-2.5">{row.allocatedAt ? formatDuration(row.allocationDelaySeconds) : daysSince(row.screeningCompletedAt || row.submittedForReviewAt || row.createdAt)}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-2.5">{row.childName}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-2.5">{provinceNameForCase(row, districts)}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-2.5">{row.district}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-2.5">{row.concern}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-2.5">{row.intakeOfficer || "Intake Officer"}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-2.5"><CaseStatusBadge status={row.status} /></td>
                  {mode === "attention" && <td className="border-b border-[#edf0f4] px-3 py-2.5 font-medium leading-5 text-[#475569]">{attentionReasonsByCaseId.get(row.id)?.join(", ") || "Needs review"}</td>}
                  <td className="border-b border-[#edf0f4] px-3 py-2.5"><div className="inline-flex items-center gap-2 whitespace-nowrap"><span className="font-semibold text-[#263747]">{row.deadline}</span><span className="text-xs font-bold text-[#64748b]">{row.deadlineStatus}</span></div></td>
                  <td className="border-b border-[#edf0f4] px-3 py-2.5">{row.allocatedOfficer || "-"}</td>
                </tr>
              )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={mode === "attention" ? 12 : 11}>{emptyMessage}</td></tr>}
            </tbody>
          </table>
          </div>
          <TablePagination totalRows={filteredCaseRows.length} pageStart={pageStart} pageEnd={pageEnd} rowsPerPage={rowsPerPage} setRowsPerPage={setRowsPerPage} page={safePage} pageCount={pageCount} setPage={setPage} />
        </div>
      </Panel>

    </div>
  )
}

function CapturedCaseReadOnly({ row, showOverviewTiles = true }: { row: DistrictHeadCaseRow; showOverviewTiles?: boolean }) {
  const alert = row.sourceAlert
  const empty = "Not captured"
  const intake = row.intakeDraft
  const opening = objectValue(intake?.opening_summary)
  const informant = objectValue(opening.informant)
  const screening = objectValue(opening.screening_draft)
  const child = objectValue(intake?.child_profile_draft)
  const household = objectValue(intake?.household_profile_draft)
  const guardians = Array.isArray(household.family_members)
    ? household.family_members as GuardianDraft[]
    : Array.isArray(household.guardians)
      ? household.guardians as GuardianDraft[]
      : []
  const allegedPerpetrators: AllegedPerpetratorDraft[] = Array.isArray(intake?.alleged_perpetrators) && intake.alleged_perpetrators.length
    ? intake.alleged_perpetrators as AllegedPerpetratorDraft[]
    : (textValue(screening.accused_name) || alert?.alleged_perpetrator_name)
      ? [{ ...emptyAllegedPerpetrator(), id: "legacy-accused", name: textValue(screening.accused_name) || alert?.alleged_perpetrator_name || "", relationship_to_child: textValue(screening.accused_relationship_to_child) || alert?.alleged_perpetrator_relationship || "", sex: textValue(screening.accused_sex), race: textValue(screening.accused_race) || alert?.alleged_perpetrator_race || "", referred_to_police: textValue(screening.referred_to_police), police_referral_date: textValue(screening.police_referral_date), court_appearance_scheduled: textValue(screening.court_appearance_scheduled), court_appearance_date: textValue(screening.court_appearance_date), conviction_determined: textValue(screening.conviction_determined), conviction_date: textValue(screening.conviction_date), circumstances_of_offence: textValue(screening.circumstances_of_offence) }]
      : []
  const background = objectValue(intake?.background_information || row.background_information)
  const previousContacts = normalizePreviousContacts(background.previous_contacts)
  const concerns = arrayValue(screening.selected_categories).length ? arrayValue(screening.selected_categories).join(", ") : alert ? alertConcerns(alert).join(", ") : row.concern
  const sourceName = textValue(informant.first_names) || alert?.information_source_name || empty
  const sourceContact = textValue(informant.phone) || alert?.information_source_contact || empty
  const firstValue = (...values: unknown[]) => {
    const found = values.map((value) => textValue(value).trim()).find(Boolean)
    return found || empty
  }
  const listValue = (value: unknown, fallback = empty) => {
    const items = arrayValue(value)
    return items.length ? items.join(", ") : fallback
  }
  const childName = firstValue([textValue(child.first_names), textValue(child.surname)].filter(Boolean).join(" "), row.childName)
  const guardianSummary = guardians.length
    ? guardians.map((guardian, index) => {
        const name = guardian.name || [guardian.first_names, guardian.surname].filter(Boolean).join(" ") || `Family member ${index + 1}`
        const type = guardian.family_member_type || guardian.guardian_type || guardian.person_category || "Family member"
        return `${index + 1}. ${type} - ${name}${guardian.number_of_wives ? `; number of wives: ${guardian.number_of_wives}` : ""}${guardian.order_of_wife ? `; wives: ${guardian.order_of_wife}` : ""}${guardian.telephone ? `; ${guardian.telephone}` : ""}${guardian.living_involvement_status ? `; ${guardian.living_involvement_status}` : ""}`
      }).join("\n")
    : empty
  const priorSummary = previousContactDefinitions.map(({ key, label }) => {
    const contact = previousContacts[key]
    return `${label}: ${contact.has_contact || "Not captured"}${contact.reason ? ` - ${contact.reason}` : ""}`
  }).join("\n")
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
        ["Chief name", firstValue(opening.chief_name, alert?.chief_name)],
        ["Nearest landmark", firstValue(opening.nearest_landmark, alert?.nearest_landmark)],
        ["Emergency reported", firstValue(opening.emergency_reported, alert?.emergency ? "Yes" : "No")],
        ["Immediate danger reported", firstValue(opening.immediate_danger_reported, alert?.danger?.length ? "Yes" : "No")],
        ["Concern summary", firstValue(opening.concern_summary, concerns)],
        ["Reporter narrative", firstValue(opening.reporter_narrative, alert?.description, row.description)],
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
        ["Birth registered", firstValue(child.birth_registered, alert?.birth_registered)],
        ["Disability status", firstValue(child.disability_status, alert?.disability)],
        ...(firstValue(child.disability_status, alert?.disability) === "Yes" ? [["Disability description", firstValue(child.disability_description)]] : []),
        ["Address of Child", firstValue(child.address_of_child, child.address, alert?.home_address)],
        ["Date of referral", firstValue(intake?.referral_date)],
        ["Case referred by", firstValue(intake?.case_referred_by)],
        ["Reasons for intended inquiry", firstValue(child.reasons_for_intended_inquiry)],
        ["Contact details", firstValue(child.contact_details)],
        ["Home language", firstValue(child.home_language)],
        ["Religion", firstValue(child.religion)],
        ["Race", firstValue(child.race)],
      ],
    },
    {
      title: "Family Details",
      fields: [
        ["Family members captured", guardians.length ? "Yes" : empty],
        ["Caregiver contact", firstValue(alert?.caregiver_contact)],
        ["Home address", firstValue(alert?.home_address)],
        ["Family member records", guardianSummary],
        ["Caregiving circumstances", firstValue(household.caregiving_circumstances, background.caregiving_circumstances)],
      ],
    },
    {
      title: "Case Type",
      fields: [
        ["Case categories", concerns],
        ["Primary category", firstValue(intake?.case_category, row.concern)],
        ["Concern description", firstValue(screening.concern_description, row.description)],
        ["Perpetrator known", firstValue(screening.alleged_perpetrator_known)],
        ["Accused persons", allegedPerpetrators.length ? allegedPerpetrators.map((person, index) => `${index + 1}. ${person.name}${person.relationship_to_child ? ` (${person.relationship_to_child})` : ""}`).join("\n") : empty],
      ],
    },
    {
      title: "Background",
      fields: [
        ["Previous involvement history", priorSummary],
        ["Other Background Information", firstValue(background.child_story_or_reported_circumstances)],
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
      {showOverviewTiles && <div className="grid gap-4 md:grid-cols-3">
        <MiniCard title="Priority" value={row.riskLevel} icon={AlertTriangle} />
        <MiniCard title="Deadline" value={row.deadline} icon={Clock3} />
        <MiniCard title="Current Status" value={row.status} icon={FolderCheck} />
      </div>}
      <section className="min-w-0 rounded-md border border-[#d8dee8] bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-[#263747]">Officer &amp; Informant Details</h3>
        <div className="mt-5 border-t border-[#edf0f4] pt-5">
          <h4 className="mb-5 text-sm font-bold uppercase tracking-wide text-[#2e6fa3]">Officer Details</h4>
          <SummaryFieldGrid items={[["Officer user ID", opening.officer_user_id], ["Officer surname", opening.officer_surname], ["Officer first names", opening.officer_first_names], ["Officer designation", opening.officer_designation], ["Officer district", firstValue(opening.officer_district, row.district)], ["Officer contact", opening.officer_contact]]} />
        </div>
        <div className="mt-7 border-t border-[#d8dee8] pt-5">
          <h4 className="mb-5 text-sm font-bold uppercase tracking-wide text-[#2e6fa3]">Informant Details</h4>
          <SummaryFieldGrid items={[["Surname", informant.surname], ["First names", sourceName], ["National ID", informant.id_number], ["Sex", informant.sex], ["Relationship to child", firstValue(informant.relationship_to_child, alert?.information_source_relationship_to_child)], ["Telephone", sourceContact], ["Email", informant.email], ["Address", informant.address], ["Organisation", informant.organization]]} />
        </div>
      </section>

      <section className="min-w-0 rounded-md border border-[#d8dee8] bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-[#263747]">Child Details</h3>
        <div className="mt-5 border-t border-[#edf0f4] pt-5"><SummaryFieldGrid items={[["Child known", child.known], ["Surname", child.surname], ["First names", child.first_names], ["National ID", child.id_number], ["Sex", firstValue(child.sex, row.sex)], ["Date of birth", firstValue(child.date_of_birth, alert?.date_of_birth)], ["Age", firstValue(child.age, row.age)], ["Birth registered", firstValue(child.birth_registered, alert?.birth_registered)], ["Disability status", firstValue(child.disability_status, alert?.disability)], ["Disability description", child.disability_description], ["Contact details", child.contact_details], ["Home language", child.home_language], ["Religion", child.religion], ["Race", child.race], ["District", firstValue(child.district, row.district)], ["Ward", firstValue(child.ward, row.ward)], ["Village", child.village], ["Chief name", child.chief_name], ["Address of child", firstValue(child.address_of_child, child.address, alert?.home_address)], ["Date of referral", intake?.referral_date], ["Case referred by", intake?.case_referred_by], ["Nearest landmark", child.nearest_landmark], ["Reasons for intended inquiry", child.reasons_for_intended_inquiry]]} /></div>
      </section>

      <section className="min-w-0 rounded-md border border-[#d8dee8] bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-[#263747]">Family Details</h3>
        <div className="mt-5 max-w-full overflow-x-auto rounded-md border border-[#d8dee8]"><table className="w-full min-w-[1320px] border-collapse text-left text-sm"><thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Category", "Type", "Name", "National ID", "Date of birth", "Age", "Occupation", "Employer", "Telephone", "Address", "Living status", "Wives / names"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3 font-bold">{head}</th>)}</tr></thead><tbody>{guardians.length ? guardians.map((member, index) => <tr key={`${member.id_number}-${member.telephone}-${index}`}><td className="border-b border-[#edf0f4] px-3 py-3">{member.person_category || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.family_member_type || member.guardian_type || member.person_category || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.name || [member.first_names, member.surname].filter(Boolean).join(" ") || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.id_number || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.date_of_birth || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.estimated_age || member.dob_or_age || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.occupation || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.employer || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.telephone || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.address || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{member.living_involvement_status || "-"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{[member.number_of_wives, member.order_of_wife].filter(Boolean).join(" / ") || "-"}</td></tr>) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={12}>No family members captured yet.</td></tr>}</tbody></table></div>
        <div className="mt-6 border-t border-[#edf0f4] pt-5"><SummaryFieldGrid items={[["Circumstances of parents / caregiving", firstValue(household.caregiving_circumstances, background.caregiving_circumstances)]]} /></div>
      </section>

      <section className="min-w-0 rounded-md border border-[#d8dee8] bg-white p-6 shadow-sm"><h3 className="text-lg font-bold text-[#263747]">Case Type</h3><div className="mt-5 border-t border-[#edf0f4] pt-5"><SummaryFieldGrid items={[["Selected case types", arrayValue(screening.selected_categories)], ["Juvenile delinquency offences", arrayValue(screening.juvenile_offences)], ["Other property offence", screening.juvenile_other_property_offence], ["Safeguarding classification", firstValue(intake?.safeguarding_classification, intake?.emergency_classification)], ["Classification triggers", intake?.classification_trigger_codes || []], ["Perpetrator known", screening.alleged_perpetrator_known], ["Number of accused persons", allegedPerpetrators.length]]} /></div><div className="mt-6"><h4 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#2e6fa3]">Alleged perpetrators</h4><AllegedPerpetratorTable records={allegedPerpetrators} /></div></section>

      <section className="min-w-0 rounded-md border border-[#d8dee8] bg-white p-6 shadow-sm"><h3 className="text-lg font-bold text-[#263747]">Background Information</h3><div className="mt-5 max-w-full overflow-x-auto rounded-md border border-[#d8dee8]"><table className="w-full min-w-[700px] border-collapse text-left text-sm"><thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Previous contact", "Response", "Reason"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-4 py-3 font-bold">{head}</th>)}</tr></thead><tbody>{previousContactDefinitions.filter(({ key }) => previousContacts[key].has_contact).map(({ key, label }) => <tr key={key}><td className="border-b border-[#edf0f4] px-4 py-3 font-semibold">{label}</td><td className="border-b border-[#edf0f4] px-4 py-3">{previousContacts[key].has_contact}</td><td className="border-b border-[#edf0f4] px-4 py-3 whitespace-pre-wrap">{previousContacts[key].reason || "-"}</td></tr>)}{!previousContactDefinitions.some(({ key }) => previousContacts[key].has_contact) && <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={3}>No previous contacts captured.</td></tr>}</tbody></table></div><div className="mt-6 border-t border-[#edf0f4] pt-5"><SummaryFieldGrid items={[["Other background information", background.child_story_or_reported_circumstances], ["Background organisation", screening.background_organisation], ["Background services", arrayValue(screening.background_services)], ["Other background service", screening.other_background_service], ["Background service notes", screening.background_service_notes]]} /></div></section>

      <section className="min-w-0 rounded-md border border-[#d8dee8] bg-white p-6 shadow-sm"><h3 className="text-lg font-bold text-[#263747]">Intake Details</h3><div className="mt-5 border-t border-[#edf0f4] pt-5"><SummaryFieldGrid items={[["Case ID", row.id], ["Intake number", opening.intake_number], ["Date reported", firstValue(opening.date_reported, row.createdAt)], ["Intake source", firstValue(intake?.intake_source, opening.source)], ["Submitted for review", firstValue(screening.submitted_for_review_at, row.submittedForReviewAt)]]} /></div></section>
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
  const carePlanStatus = row.assessmentCarePlanStatus || "Draft"
  const closureStatus = row.closureStatus || "Not Requested"

  if (closureStatus === "Approved") return "Closed"
  if (["Requested", "Submitted"].includes(closureStatus)) return "Closure awaiting DSDO approval"
  if (["Returned", "Rejected"].includes(closureStatus)) return "Closure returned for revision"
  if (["Approved", "Approved with Comments"].includes(carePlanStatus)) return "Assessment & care plan approved"
  if (carePlanStatus === "Assessment Approved") return "Assessment approved — care plan review pending"
  if (carePlanStatus === "Submitted") return "Assessment & care plan awaiting DSDO review"
  if (carePlanStatus === "Assessment Revision Requested") return "Assessment returned for revision"
  if (carePlanStatus === "Care Plan Revision Requested") return "Care plan returned for revision"
  if (row.assessmentCompletedAt) return "Care plan in progress"
  return "Assessment in progress"
}

function nextAllocatedAction(row: DistrictHeadCaseRow) {
  const carePlanStatus = row.assessmentCarePlanStatus || "Draft"
  const closureStatus = row.closureStatus || "Not Requested"
  const hasCarePlanItems = draftArray(row.intakeDraft?.care_plan_draft?.items).length > 0
  const referrals = draftArray(row.intakeDraft?.referrals_draft)
  const implementation = draftArray(row.intakeDraft?.service_tracking_draft)
  const monitoring = draftArray(row.intakeDraft?.monitoring_followups_draft)
  if (closureStatus === "Approved") return "No action — case closed"
  if (["Requested", "Submitted"].includes(closureStatus)) return "Await DSDO closure decision"
  if (["Returned", "Rejected"].includes(closureStatus)) return "Review and resubmit closure"
  if (monitoring.length) return "Continue monitoring or prepare closure"
  if (implementation.some((item) => ["Referred", "In Progress", "Completed"].includes(textValue(item.status)) || Boolean(textValue(item.implementationNotes)))) return "Update implementation and monitoring"
  if (referrals.length) return "Begin care plan implementation"
  if (carePlanStatus === "Assessment Revision Requested") return "Revise and resubmit assessment"
  if (carePlanStatus === "Care Plan Revision Requested") return "Revise and resubmit care plan"
  if (carePlanStatus === "Submitted") return "Await DSDO assessment review"
  if (carePlanStatus === "Assessment Approved") return "Await DSDO care plan review"
  if (["Completed", "Approved", "Approved with Comments"].includes(carePlanStatus)) return "Complete court orders and referrals"
  if (hasCarePlanItems) return "Complete and submit care plan"
  if (row.assessmentCompletedAt) return "Develop care plan"
  const risk = row.riskLevel.toUpperCase()
  if (risk === "CRITICAL" || risk === "HIGH") return "Start assessment and confirm safety"
  return "Start assessment"
}

type CarePlanRow = {
  problem: string
  problemArea?: string
  assistanceType: string
  otherAssistanceDescription?: string
  goal: string
  plannedAction: string
  responsiblePerson?: string
  otherResponsiblePerson?: string
  referralRequired?: string
  timeline: string
  dueDate: string
  status: string
  actionPlanNotes: string
  requiresCourtRecommendation?: string
  courtRecommendation?: string
  notes?: string
}

type CarePlanVersion = {
  id: string
  caseId: string
  versionNumber: number
  status: string
  items: CarePlanRow[]
  childStory: string
  createdBy: string
  createdAt: string
  reasonForChange: string
  linkedReviewId?: string
  isActive: boolean
}

type CarePlanChangeLog = {
  id: string
  caseId: string
  carePlanVersionId: string
  linkedReviewId?: string
  changeType: string
  carePlanItem: string
  fieldChanged: string
  oldValue: string
  newValue: string
  reason: string
  changedBy: string
  changedAt: string
}

type CaseConferenceRecord = {
  id: string
  date: string
  participants: string
  decisions: string
  notes: string
}

type CourtOrderRecord = {
  id: string
  courtOrderType: string
  courtName: string
  courtCaseNumber: string
  dateIssued: string
  expiryDate: string
  status: string
  courtDecision: string
  notes: string
}

type JusticeDraft = {
  courtOrders: CourtOrderRecord[]
}

type CaseReviewRecord = {
  id: string
  caseId: string
  reviewDate: string
  outcome: string
  riskLevel: string
  carePlanDecision: string
  finalDecision: string
  newProblems: string
  officerAnalysis: string
  linkedCarePlanVersionId?: string
  revisedCarePlanSummary?: string
  status: string
  createdBy: string
  createdAt: string
}

type ClosureProcessCompleted = {
  childFamilyDiscussionAgreed: boolean
  safetyConcernsResolved: boolean
  carePlanGoalsMet: boolean
  childAwareOfResources: boolean
  childEndingAgainstAdvice: boolean
}

type ClosureRecord = {
  id: string
  caseId: string
  recommendedAt: string
  recommendedBy: string
  reasons: string[]
  otherReason: string
  currentSituation: string
  outstandingConcerns: string
  sustainabilityAssessment: string
  effortsMade: string
  processCompleted: ClosureProcessCompleted
  childInformed: string
  childFamilyInformed: string
  futureResourcesExplained: string
  finalRiskLevel: string
  decision: string
  status: string
  approvedBy?: string
  approvedAt?: string
  supervisorReason?: string
}

type ServiceTrackingRow = {
  plannedAction: string
  implementationNotes: string
  status: string
  implementationDate: string
  deliveredBy: string
}

function normalizeServiceTrackingRow(value: unknown, careItem?: CarePlanRow): ServiceTrackingRow {
  const source = draftObject(value)
  const status = `${source.status || "Planned"}`
  return {
    plannedAction: `${careItem?.assistanceType || careItem?.plannedAction || source.plannedAction || ""}`,
    implementationNotes: `${source.implementationNotes || source.progress || source.outcome || ""}`,
    status: ["Planned", "Referred", "In Progress", "Completed", "Cancelled"].includes(status) ? status : status === "Accepted" ? "Referred" : status === "Ongoing" ? "In Progress" : "Planned",
    implementationDate: `${source.implementationDate || source.updateDate || ""}`,
    deliveredBy: `${source.deliveredBy || source.responsiblePerson || careItem?.responsiblePerson || ""}`,
  }
}

type ReferralRow = {
  linkedCarePlanItem: string
  type: string
  date: string
  followUpDate: string
  referredTo: string
  referralAgency: string
  contactPerson: string
  address: string
  telephone: string
  briefCircumstances: string
  reason: string
  outcome: string
}

function hasRecordedReferralData(referral: ReferralRow) {
  return Boolean(
    referral.linkedCarePlanItem?.trim() ||
    referral.referredTo?.trim() ||
    referral.referralAgency?.trim() ||
    referral.reason?.trim() ||
    referral.outcome?.trim()
  )
}

type CaseDocumentRow = {
  documentType: string
  fileName: string
  notes: string
  previewUrl?: string
}

type DisplayAttachmentRow = CaseDocumentRow & {
  source: "case" | "public"
  sourceLabel: string
  originalIndex?: number
}

type TimelineCard = {
  label: string
  value: string
  status?: string
  tone?: "draft" | "review" | "warning" | "danger"
}

type MonitoringAreaKey =
  | "safety"
  | "placement"
  | "health"
  | "education"
  | "psychosocial"
  | "family"
  | "behaviour"
  | "reunification"
  | "court"
  | "referral"
  | "other"

type MonitoringAreaResponse = Record<string, string>

type MonitoringRecord = {
  id: string
  caseId: string
  followUpDate: string
  followUpType: string
  personsContacted: string[]
  location: string
  carePlanItemFollowedUp: string
  carePlanItemStatusAtFollowUp: string
  areasMonitored: MonitoringAreaKey[]
  dynamicAreaResponses: Partial<Record<MonitoringAreaKey, MonitoringAreaResponse>>
  childSafe: string
  overallOutcome: string
  newRisksIdentified: string
  newRiskDetails: string
  overallFindings: string
  recommendedNextStep: string
  emergencyActionRequired: string
  emergencyActionTaken: string
  notifiedPerson: string
  notifiedAt: string
  nextFollowUpRequired: string
  nextFollowUpDate: string
  suggestedNextFollowUpDate: string
  dateAdjustmentReason: string
  recordedBy: string
  recordedAt: string
  updatedBy: string
  updatedAt: string
}

type CaseNoteRow = {
  caseNote: string
}

function hasMeaningfulCaseNote(note: Partial<CaseNoteRow>) {
  return Boolean(note.caseNote?.trim())
}

function normalizeCaseNote(note: Record<string, unknown>): CaseNoteRow {
  if (typeof note.caseNote === "string") return { caseNote: note.caseNote }
  const legacyParts = [
    ["Date", note.date],
    ["Activity Type", note.activityType],
    ["Person Contacted", note.person],
    ["Summary / Action Taken", note.summary],
    ["Next Step", note.nextStep],
    ["Follow-up Date", note.followUp],
  ].filter(([, value]) => typeof value === "string" && value.trim())
  return { caseNote: legacyParts.map(([label, value]) => `${label}: ${value}`).join("\n") }
}

function normalizeCarePlanRow(item: Partial<CarePlanRow> & Record<string, unknown>): CarePlanRow {
  const legacyAssistanceTypes = Array.isArray(item.assistanceTypes) ? item.assistanceTypes.map(String) : Array.isArray(item.assistance_types) ? item.assistance_types.map(String) : []
  const assistanceType = `${item.assistanceType || item.assistance_type || legacyAssistanceTypes[0] || item.plannedAction || item.intervention || ""}`
  const responsiblePerson = `${item.responsiblePerson || item.responsible_person || "Allocated Officer"}`
  const automaticallyRequiresReferral = ["Children's Court", "NGO Partner", "Health Facility", "Police", "School"].includes(responsiblePerson)
  return {
    problem: `${item.problem || ""}`,
    problemArea: `${item.problemArea || item.problem_area || ""}`,
    assistanceType,
    otherAssistanceDescription: `${item.otherAssistanceDescription || item.other_assistance_description || ""}`,
    goal: `${item.goal || ""}`,
    plannedAction: `${item.plannedAction || item.intervention || ""}`,
    responsiblePerson,
    otherResponsiblePerson: `${item.otherResponsiblePerson || item.other_responsible_person || ""}`,
    referralRequired: automaticallyRequiresReferral ? "Yes" : ["Allocated Officer", "DSDO", "CCW", "Caregiver"].includes(responsiblePerson) ? "No" : `${item.referralRequired || item.referral_required || ""}`,
    timeline: `${item.timeline || item.deadline || "30 Days"}`,
    dueDate: `${item.dueDate || ""}`,
    status: `${item.status || "Planned"}`,
    actionPlanNotes: `${item.actionPlanNotes || item.action_plan_notes || item.expectedOutcome || item.expected_outcome || ""}`,
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
    caseConferenceHeld: draft.caseConferenceHeld === "Yes" || draft.case_conference_held === "Yes" ? "Yes" : "No",
    items: normalizeCarePlanRows(draftArray(draft.items)),
  }
}

function draftArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function draftObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

const assessmentNarrativeFields = [
  "milestonesAssessmentNotes", "personalityTraits", "healthStatusAndNeeds", "educationalStatusAndNeeds",
  "provisionBasicCare", "food", "shelter", "medication", "disabilityIssues", "childSafetyNeeds",
  "emotionalWarmth", "motivationAndStimulation", "guidanceAndBoundaries", "relationshipsSignificantOthers",
  "historyAndCurrentSituation", "familyFunctioning", "familyRelationships", "dealingWithArguments",
  "socialResources", "communityResources",
] as const

type AssessmentNarrativeKey = typeof assessmentNarrativeFields[number]

type AssessmentNarrativeDefinition = { key: AssessmentNarrativeKey; title: string; description: string; placeholder: string }

const childDevelopmentAssessmentSections: AssessmentNarrativeDefinition[] = [
  { key: "milestonesAssessmentNotes", title: "Milestones (Sitting, Crawling, Walking, Talking, Toilet Training, etc.)", description: "Record milestones observed or achieved and relevant developmental information.", placeholder: "Describe the child's developmental milestones, any delays observed, concerns identified and other relevant developmental information." },
  { key: "personalityTraits", title: "Personality Traits", description: "Describe professional observations without applying system-created personality labels.", placeholder: "Describe the child's personality, behaviour, emotional presentation, interaction with others and any relevant observations made during the assessment." },
  { key: "healthStatusAndNeeds", title: "The Child's Health Status and Needs", description: "Record the child's physical and mental health status and needs.", placeholder: "Describe the child's physical and mental health status, illnesses, medical conditions, treatment, medication, nutrition, disability-related needs, access to health services and any other health concerns." },
  { key: "educationalStatusAndNeeds", title: "The Child's Educational Status and Needs", description: "Record the child's educational status and required support.", placeholder: "Describe the child's enrolment status, school or learning arrangement, grade or form where applicable, attendance, performance, learning difficulties, barriers to education and educational support required." },
]

const parentCarerAssessmentSections: AssessmentNarrativeDefinition[] = [
  { key: "provisionBasicCare", title: "Provision of Basic Care", description: "Assess how essential daily care is provided.", placeholder: "Describe how the parent or carer provides the child with daily care, supervision, hygiene, clothing and other essential needs." },
  { key: "food", title: "Food", description: "Assess the child's access to suitable food.", placeholder: "Describe the availability, adequacy, regularity and quality of food provided to the child, including any nutritional concerns." },
  { key: "shelter", title: "Shelter", description: "Assess living and sleeping arrangements.", placeholder: "Describe the child's living arrangements, condition and safety of the shelter, sleeping arrangements, overcrowding and any shelter-related needs." },
  { key: "medication", title: "Medication", description: "Assess access to and use of required medication.", placeholder: "Describe whether required medication is available, administered correctly and accessed consistently, including any barriers to treatment." },
  { key: "disabilityIssues", title: "Disability Issues", description: "Assess disability-related care and support issues.", placeholder: "Describe any disability-related issues affecting the child or the parent/carer's ability to meet the child's needs, including assistive devices, accessibility, care requirements and available support." },
  { key: "childSafetyNeeds", title: "Child's Safety Needs (How parents/carers ensure the child is safe from outside pressures, including internet and peer-pressure influence)", description: "Consider protection from harm, outside pressures, internet risks, unsafe peer influence and other environmental risks.", placeholder: "Describe how the parent or carer ensures the child's safety, any existing protection concerns and any areas where additional support is required." },
  { key: "emotionalWarmth", title: "Emotional Warmth (How the parent/carer comforts the child, praises, and shows love and care)", description: "Consider comfort, praise, love, care and affection.", placeholder: "Describe the emotional support, affection, encouragement, comfort and reassurance provided to the child." },
  { key: "motivationAndStimulation", title: "Motivation and Stimulation", description: "Assess support for learning, development and participation.", placeholder: "Describe how the parent or carer encourages the child's learning, development, play, interests, participation and achievement." },
  { key: "guidanceAndBoundaries", title: "Guidance and Boundaries", description: "Assess guidance, discipline and age-appropriate boundaries.", placeholder: "Describe how the parent or carer provides guidance, discipline, supervision, rules, routines and age-appropriate boundaries." },
  { key: "relationshipsSignificantOthers", title: "Relationships with Significant Others", description: "Assess important relationships and their support or risks.", placeholder: "Describe the child's and family's relationships with relatives, caregivers, friends, neighbours and other important persons, including the support or risks associated with these relationships." },
]

const environmentalAssessmentSections: AssessmentNarrativeDefinition[] = [
  { key: "historyAndCurrentSituation", title: "History and Current Situation", description: "Record relevant family history and present circumstances.", placeholder: "Describe the family's relevant history, present circumstances, major life events, changes in caregiving arrangements and current challenges affecting the child." },
  { key: "familyFunctioning", title: "Family Functioning", description: "Describe how the family operates day to day.", placeholder: "Describe how the family operates on a daily basis, including roles, responsibilities, communication, decision-making, support and any difficulties affecting the child." },
  { key: "familyRelationships", title: "Family Relationships", description: "Describe the quality and effect of family relationships.", placeholder: "Describe relationships between family members, the quality of interaction, support, attachment, tension and any relationship difficulties affecting the child." },
  { key: "dealingWithArguments", title: "Dealing with Arguments", description: "Describe how disagreement and conflict are managed.", placeholder: "Describe how family members manage disagreements, arguments and conflict, including whether disputes are resolved safely and constructively." },
  { key: "socialResources", title: "Social Relations", description: "Record social networks available to the child and family.", placeholder: "Describe the support available to the child and family from relatives, friends, neighbours, religious groups, support groups and other social networks." },
  { key: "communityResources", title: "Community Resources", description: "Record services and resources available in the community.", placeholder: "Describe services and resources available within the community, including schools, health facilities, social services, child protection structures, places of safety and partner organisations." },
]

type ApprovedAssessmentDraft = {
  schemaVersion: string
  assessmentDate: string
  assessmentType: string
  assessmentLocation: string
  childSeen: string
  parentCarerSeen: string
  personsInterviewed: string[]
  otherPersonInterviewed: string
  assessmentVisitNotes: string
  childOwnStory: string
  milestones: string[]
  otherMilestone: string
} & Record<AssessmentNarrativeKey, string>

function emptyApprovedAssessment(row: DistrictHeadCaseRow): ApprovedAssessmentDraft {
  const draft = {
    schemaVersion: "APPROVED-MANUAL-2026-1",
    assessmentDate: new Date().toISOString().slice(0, 10),
    assessmentType: "",
    assessmentLocation: row.district,
    childSeen: "",
    parentCarerSeen: "",
    personsInterviewed: [] as string[],
    otherPersonInterviewed: "",
    assessmentVisitNotes: "",
    childOwnStory: "",
    milestones: [] as string[],
    otherMilestone: "",
  } as ApprovedAssessmentDraft
  assessmentNarrativeFields.forEach((key) => {
    draft[key] = ""
  })
  return draft
}

function normalizeApprovedAssessment(value: unknown, row: DistrictHeadCaseRow): ApprovedAssessmentDraft {
  const source = draftObject(value)
  const draft = emptyApprovedAssessment(row)
  ;(["assessmentDate", "assessmentType", "assessmentLocation", "childSeen", "parentCarerSeen", "otherPersonInterviewed", "assessmentVisitNotes", "childOwnStory", "otherMilestone"] as const).forEach((key) => {
    if (typeof source[key] === "string") draft[key] = source[key] as string
  })
  draft.personsInterviewed = arrayValue(source.personsInterviewed)
  draft.milestones = arrayValue(source.milestones)
  assessmentNarrativeFields.forEach((key) => {
    draft[key] = textValue(source[key])
  })
  return draft
}

function allocatedCaseProgressTab(row: DistrictHeadCaseRow) {
  if (!row.assessmentCompletedAt) return "assessment"
  if (!["Completed", "Submitted", "Approved", "Approved with Comments"].includes(row.assessmentCarePlanStatus || "")) return "care"
  return "referrals"
}

function AllocatedCaseWorkspace({ row, canManage, onBack, onOpenFullIntake, saveCalendarTasks, backLabel = "Back to allocated cases" }: { row: DistrictHeadCaseRow; canManage: boolean; onBack: () => void; onOpenFullIntake?: () => void; saveCalendarTasks?: (tasks: CalendarTask[]) => Promise<void>; backLabel?: string }) {
  const backendAssessmentDraft = draftObject(row.intakeDraft?.assessment_draft)
  const backendCarePlanDraft = draftObject(row.intakeDraft?.care_plan_draft)
  const [activeTab, setActiveTab] = useState(() => !canManage && ["Submitted", "Assessment Approved"].includes(row.assessmentCarePlanStatus || "") ? "assessment" : allocatedCaseProgressTab(row))
  const [assessmentStep, setAssessmentStep] = useState(0)
  const [completedAssessmentSteps, setCompletedAssessmentSteps] = useState<number[]>([])
  const [openAssessmentSections, setOpenAssessmentSections] = useState<string[]>([])
  const [caseHealthOpen, setCaseHealthOpen] = useState(false)
  const [caseStatus, setCaseStatus] = useState("Allocated")
  const [assessmentStatus, setAssessmentStatus] = useState(row.assessmentCompletedAt ? "Completed" : "Not Started")
  const [carePlanStatus, setCarePlanStatus] = useState(row.assessmentCarePlanStatus || "Draft")
  const [approvalReviewNotes, setApprovalReviewNotes] = useState("")
  const [approvalReviewing, setApprovalReviewing] = useState(false)
  const [approvalDialog, setApprovalDialog] = useState<{ title: string; detail: string; nextTab?: "care" } | null>(null)
  const [submissionDialogOpen, setSubmissionDialogOpen] = useState(false)
  const [closureStatus, setClosureStatus] = useState(row.closureStatus || "Not Requested")
  const [supervisorReviewNotes, setSupervisorReviewNotes] = useState("")
  const [supervisorReviewDecision, setSupervisorReviewDecision] = useState("Continue case")
  const [message, setMessage] = useState("")
  const [assessmentFieldErrors, setAssessmentFieldErrors] = useState<Record<string, string>>({})
  const [workspaceAutosave, setWorkspaceAutosave] = useState("Autosave ready")
  const [changeRequests, setChangeRequests] = useState<IntakeUpdateRequest[]>([])
  const [changeRequestsOpen, setChangeRequestsOpen] = useState(false)
  const [selectedChangeRequestId, setSelectedChangeRequestId] = useState<number | null>(null)
  const [caseTimelineOpen, setCaseTimelineOpen] = useState(false)
  const approvalPending = ["Submitted", "Assessment Approved"].includes(carePlanStatus)
  const assessmentApproved = carePlanStatus === "Assessment Approved" || ["Approved", "Approved with Comments", "Care Plan Revision Requested"].includes(carePlanStatus)
  const packageApproved = ["Approved", "Approved with Comments"].includes(carePlanStatus)
  const revisionRequested = ["Assessment Revision Requested", "Care Plan Revision Requested"].includes(carePlanStatus)
  const workflowLockedForOfficer = canManage && approvalPending
  const activeSectionLocked = !canManage || workflowLockedForOfficer || (!packageApproved && !["details", "assessment", "care"].includes(activeTab)) || (canManage && assessmentApproved && activeTab === "assessment")

  useEffect(() => {
    setCarePlanStatus(row.assessmentCarePlanStatus || "Draft")
  }, [row.assessmentCarePlanStatus])

  useEffect(() => {
    setClosureStatus(row.closureStatus || "Not Requested")
  }, [row.closureStatus])

  useEffect(() => {
    if (!row.backendIntakeId) return
    let disposed = false
    const refreshWorkflowDecision = async () => {
      try {
        const latest = await apiGet<IntakeRecord>(`/intakes/${row.backendIntakeId}/`)
        if (disposed) return
        row.intakeDraft = latest
        row.assessmentCarePlanStatus = latest.assessment_care_plan_status || "Draft"
        row.closureStatus = latest.closure_status || "Not Requested"
        setCarePlanStatus(row.assessmentCarePlanStatus)
        setClosureStatus(row.closureStatus)
        if (Array.isArray(latest.care_plan_versions_draft)) setCarePlanVersions(latest.care_plan_versions_draft as CarePlanVersion[])
      } catch {
        // Keep the loaded workspace usable during a temporary refresh failure.
      }
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshWorkflowDecision()
    }
    void refreshWorkflowDecision()
    const timer = window.setInterval(() => void refreshWorkflowDecision(), 15_000)
    window.addEventListener("focus", refreshWorkflowDecision)
    document.addEventListener("visibilitychange", refreshWhenVisible)
    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener("focus", refreshWorkflowDecision)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
    }
  }, [row.backendIntakeId])

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(""), 10_000)
    return () => window.clearTimeout(timer)
  }, [message])

  useEffect(() => {
    if (!Object.keys(assessmentFieldErrors).length) return
    const timer = window.setTimeout(() => setAssessmentFieldErrors({}), 10_000)
    return () => window.clearTimeout(timer)
  }, [assessmentFieldErrors])

  const workspaceDraftKey = `ncms:allocated-workspace:${row.id}`
  const [assessment, setAssessment] = useState<ApprovedAssessmentDraft>(() => normalizeApprovedAssessment(backendAssessmentDraft, row))
  const assessmentHydratedRef = useRef(false)
  const latestAssessmentRef = useRef(assessment)
  const assessmentSaveInFlightRef = useRef(false)
  const assessmentSavePendingRef = useRef(false)
  const lastAssessmentAutosavePayloadRef = useRef(JSON.stringify(assessment))
  latestAssessmentRef.current = assessment
  const childStorySummary = assessment.childOwnStory || [assessment.historyAndCurrentSituation, assessment.personalityTraits, assessment.educationalStatusAndNeeds].filter(Boolean).join("\n") || "Child circumstances, wishes, ambitions and aspirations to be confirmed from assessment."
  const assessmentIsCompleted = assessmentStatus === "Completed" || Boolean(row.assessmentCompletedAt)
  const backendCarePlan = normalizeCarePlanDraft(backendCarePlanDraft, childStorySummary)
  const [carePlanChildStory, setCarePlanChildStory] = useState(backendCarePlan.childStory)
  const [careRows, setCareRows] = useState<CarePlanRow[]>(backendCarePlan.items)
  const initialCarePlanVersion: CarePlanVersion = {
    id: `${row.id}-care-version-1`,
    caseId: row.id,
    versionNumber: 1,
    status: carePlanStatus || "Draft",
    items: backendCarePlan.items,
    childStory: backendCarePlan.childStory,
    createdBy: row.allocatedOfficer || "Allocated officer",
    createdAt: row.createdAt,
    reasonForChange: "Initial care plan",
    isActive: true,
  }
  const [carePlanVersions, setCarePlanVersions] = useState<CarePlanVersion[]>(draftArray(row.intakeDraft?.care_plan_versions_draft).length ? draftArray(row.intakeDraft?.care_plan_versions_draft) as CarePlanVersion[] : [initialCarePlanVersion])
  const hasPendingCarePlanChange = carePlanVersions.some((version) => ["Pending DSDO Approval", "Pending District Head Approval"].includes(version.status))
  const carePlanLocked = packageApproved || hasPendingCarePlanChange
  const [carePlanChangeLogs, setCarePlanChangeLogs] = useState<CarePlanChangeLog[]>(draftArray(row.intakeDraft?.care_plan_change_logs_draft) as CarePlanChangeLog[])
  const [caseConferences, setCaseConferences] = useState<CaseConferenceRecord[]>(draftArray(row.intakeDraft?.case_conferences_draft) as CaseConferenceRecord[])
  const [caseConferenceHeld, setCaseConferenceHeld] = useState(backendCarePlan.caseConferenceHeld)
  const emptyCaseConferenceDraft = (): CaseConferenceRecord => ({
    id: `conference-${Date.now()}`,
    date: new Date().toISOString().slice(0, 10),
    participants: "",
    decisions: "",
    notes: "",
  })
  const [caseConferenceModalIndex, setCaseConferenceModalIndex] = useState<number | null>(null)
  const [caseConferenceModalOpen, setCaseConferenceModalOpen] = useState(false)
  const [caseConferenceDraft, setCaseConferenceDraft] = useState<CaseConferenceRecord>(emptyCaseConferenceDraft)
  const [carePlanRevisionReason, setCarePlanRevisionReason] = useState("")
  const [carePlanChangeRequestOpen, setCarePlanChangeRequestOpen] = useState(false)
  const [carePlanChangeMode, setCarePlanChangeMode] = useState<"" | "create" | "update">("")
  const [carePlanChangeTargetIndex, setCarePlanChangeTargetIndex] = useState<number | null>(null)
  const [carePlanChangeStage, setCarePlanChangeStage] = useState<"choose" | "reason">("choose")
  const [reviewLinkedRevisionId, setReviewLinkedRevisionId] = useState("")
  const emptyCaseReviewDraft = (): CaseReviewRecord => ({
    id: `review-${Date.now()}`,
    caseId: row.id,
    reviewDate: new Date().toISOString().slice(0, 10),
    outcome: "",
    riskLevel: row.riskLevel.toUpperCase(),
    carePlanDecision: "",
    finalDecision: "",
    newProblems: "",
    officerAnalysis: "",
    linkedCarePlanVersionId: "",
    revisedCarePlanSummary: "",
    status: "Draft",
    createdBy: row.allocatedOfficer || "Allocated officer",
    createdAt: new Date().toISOString(),
  })
  const [caseReviews, setCaseReviews] = useState<CaseReviewRecord[]>(draftArray(row.intakeDraft?.case_reviews_draft) as CaseReviewRecord[])
  const [caseReviewModalOpen, setCaseReviewModalOpen] = useState(false)
  const [caseReviewDraft, setCaseReviewDraft] = useState<CaseReviewRecord>(emptyCaseReviewDraft)
  const emptyClosureProcessCompleted = (): ClosureProcessCompleted => ({
    childFamilyDiscussionAgreed: false,
    safetyConcernsResolved: false,
    carePlanGoalsMet: false,
    childAwareOfResources: false,
    childEndingAgainstAdvice: false,
  })
  const emptyClosureDraft = (): ClosureRecord => ({
    id: `closure-${Date.now()}`,
    caseId: row.id,
    recommendedAt: new Date().toISOString(),
    recommendedBy: row.allocatedOfficer || "Allocated officer",
    reasons: [],
    otherReason: "",
    currentSituation: "",
    outstandingConcerns: "",
    sustainabilityAssessment: "",
    effortsMade: "",
    processCompleted: emptyClosureProcessCompleted(),
    childInformed: "",
    childFamilyInformed: "",
    futureResourcesExplained: "",
    finalRiskLevel: row.riskLevel.toUpperCase(),
    decision: "Pending Supervisor Approval",
    status: "Draft",
  })
  const [closureDraft, setClosureDraft] = useState<ClosureRecord>(() => {
    const storedDraft = draftObject(row.intakeDraft?.closure_draft) as Partial<ClosureRecord>
    return { ...emptyClosureDraft(), ...storedDraft, processCompleted: { ...emptyClosureProcessCompleted(), ...draftObject(storedDraft.processCompleted) } }
  })
  const [closureHistory, setClosureHistory] = useState<ClosureRecord[]>(draftArray(row.intakeDraft?.closure_history_draft) as ClosureRecord[])
  const [closureModalOpen, setClosureModalOpen] = useState(false)
  const careAssistanceTypes = ["Counselling", "Court Supervision", "Family Casework", "Family Reunification", "Education Award", "Health Assistance", "Financial Assistance", "Birth Registration", "Psychosocial / Mental Health", "Disability Assistance", "Bus Warrants", "Remove from Street", "Child Justice Assistance", "Pre-trial Diversion", "HIV Stigma Support", "Other"]
  const careResponsibleOptions = ["Allocated Officer", "DSDO", "CCW", "Children's Court", "NGO Partner", "Health Facility", "Police", "Caregiver", "School", "Other"]
  const carePlanPayload = () => ({
    child_story: carePlanChildStory,
    childStory: carePlanChildStory,
    case_conference_held: caseConferenceHeld,
    caseConferenceHeld: caseConferenceHeld,
    items: careRows.map(normalizeCarePlanRow),
  })
  function suggestedCareAssistanceTypes() {
    const signal = [assessment.educationalStatusAndNeeds, assessment.childSafetyNeeds, assessment.healthStatusAndNeeds, assessment.disabilityIssues, assessment.food, assessment.provisionBasicCare, assessment.personalityTraits, assessment.historyAndCurrentSituation, assessment.familyFunctioning].join(" ").toLowerCase()
    const suggestions = new Set<string>()
    if (signal.includes("education") || signal.includes("school") || signal.includes("dropout")) suggestions.add("Education Assistance")
    if (signal.includes("food") || signal.includes("financial") || signal.includes("poverty") || signal.includes("fees")) suggestions.add("Financial Assistance")
    if (signal.includes("health") || signal.includes("medical")) suggestions.add("Health Assistance")
    if (signal.includes("birth")) suggestions.add("Birth Registration")
    if (signal.includes("disability") || signal.includes("special needs")) suggestions.add("Disability Support")
    if (signal.includes("unsafe") || signal.includes("danger") || signal.includes("abuse") || ["HIGH", "CRITICAL"].includes(row.riskLevel.toUpperCase())) {
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
    otherAssistanceDescription: "",
    goal: "",
    plannedAction: "",
    responsiblePerson: "Allocated Officer",
    otherResponsiblePerson: "",
    referralRequired: "No",
    timeline: "30 Days",
    dueDate: addDays(new Date(), 30).toISOString().slice(0, 10),
    status: "Planned",
    actionPlanNotes: "",
    requiresCourtRecommendation: "No",
    courtRecommendation: "",
    notes: "",
  })
  const [careModalIndex, setCareModalIndex] = useState<number | null>(null)
  const [careModalOpen, setCareModalOpen] = useState(false)
  const [careModalError, setCareModalError] = useState("")
  const [careDraft, setCareDraft] = useState<CarePlanRow>(emptyCareDraft)
  const [serviceModalIndex, setServiceModalIndex] = useState<number | null>(null)
  const [serviceModalOpen, setServiceModalOpen] = useState(false)
  const [serviceDraft, setServiceDraft] = useState<ServiceTrackingRow>({ plannedAction: "", implementationNotes: "", status: "Planned", implementationDate: new Date().toISOString().slice(0, 10), deliveredBy: "" })
  const emptyReferralDraft = (): ReferralRow => ({ linkedCarePlanItem: "", type: "", date: new Date().toISOString().slice(0, 10), followUpDate: "", referredTo: "", referralAgency: "", contactPerson: "", address: "", telephone: "", briefCircumstances: assessment.childOwnStory || childStorySummary, reason: "", outcome: "" })
  const [referrals, setReferrals] = useState<ReferralRow[]>(draftArray(row.intakeDraft?.referrals_draft).length ? draftArray(row.intakeDraft?.referrals_draft) as ReferralRow[] : [
    { linkedCarePlanItem: "", type: "Police/VFU", date: new Date().toISOString().slice(0, 10), followUpDate: addDays(new Date(), 7).toISOString().slice(0, 10), referredTo: "", referralAgency: "", contactPerson: "", address: "", telephone: "", briefCircumstances: assessment.childOwnStory || childStorySummary, reason: "", outcome: "" },
  ])
  const [referralModalIndex, setReferralModalIndex] = useState<number | null>(null)
  const [referralModalOpen, setReferralModalOpen] = useState(false)
  const [referralActivityLocked, setReferralActivityLocked] = useState(false)
  const [referralDraft, setReferralDraft] = useState(emptyReferralDraft)
  const [registeredPlacesOfSafety, setRegisteredPlacesOfSafety] = useState<SetupRecord[]>([])
  const [serviceRows, setServiceRows] = useState<ServiceTrackingRow[]>(() => draftArray(row.intakeDraft?.service_tracking_draft).map((item, index) => normalizeServiceTrackingRow(item, careRows[index])))
  const [caseDocuments, setCaseDocuments] = useState<CaseDocumentRow[]>(draftArray(row.intakeDraft?.case_documents_draft) as CaseDocumentRow[])
  const emptyDocumentDraft = (): CaseDocumentRow => ({ documentType: "Medical Report", fileName: "", notes: "" })
  const [documentModalIndex, setDocumentModalIndex] = useState<number | null>(null)
  const [documentModalOpen, setDocumentModalOpen] = useState(false)
  const [documentDraft, setDocumentDraft] = useState<CaseDocumentRow>(emptyDocumentDraft)
  const emptyCaseNoteDraft = (): CaseNoteRow => ({ caseNote: "" })
  const [caseNotes, setCaseNotes] = useState<CaseNoteRow[]>(
    draftArray(row.intakeDraft?.case_notes_draft).map((note) => normalizeCaseNote(objectValue(note))).filter(hasMeaningfulCaseNote),
  )
  const [caseNoteModalIndex, setCaseNoteModalIndex] = useState<number | null>(null)
  const [caseNoteModalOpen, setCaseNoteModalOpen] = useState(false)
  const [allCaseNotesModalOpen, setAllCaseNotesModalOpen] = useState(false)
  const [caseNoteDraft, setCaseNoteDraft] = useState<CaseNoteRow>(emptyCaseNoteDraft)
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ title: string; detail: string; onConfirm: () => void } | null>(null)
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
  function suggestedMonitoringDate(outcome = "Stable") {
    const risk = row.riskLevel.toUpperCase()
    const days = outcome === "Case Stabilized" ? 20 : ["HIGH", "CRITICAL"].includes(risk) ? 7 : risk === "MEDIUM" ? 30 : 60
    return addDays(new Date(), days).toISOString().slice(0, 10)
  }
  const emptyMonitoringRecord = (): MonitoringRecord => ({
    id: `monitoring-${Date.now()}`,
    caseId: row.id,
    followUpDate: new Date().toISOString().slice(0, 10),
    followUpType: "",
    personsContacted: [],
    location: "",
    carePlanItemFollowedUp: "",
    carePlanItemStatusAtFollowUp: "",
    areasMonitored: [],
    dynamicAreaResponses: {},
    childSafe: "",
    overallOutcome: "",
    newRisksIdentified: "",
    newRiskDetails: "",
    overallFindings: "",
    recommendedNextStep: "",
    emergencyActionRequired: "",
    emergencyActionTaken: "",
    notifiedPerson: "",
    notifiedAt: "",
    nextFollowUpRequired: "",
    nextFollowUpDate: suggestedMonitoringDate(),
    suggestedNextFollowUpDate: suggestedMonitoringDate(),
    dateAdjustmentReason: "",
    recordedBy: row.allocatedOfficer || "Allocated officer",
    recordedAt: new Date().toISOString(),
    updatedBy: row.allocatedOfficer || "Allocated officer",
    updatedAt: new Date().toISOString(),
  })
  const [monitoringRecords, setMonitoringRecords] = useState<MonitoringRecord[]>(draftArray(row.intakeDraft?.monitoring_followups_draft) as MonitoringRecord[])
  const [monitoringModalOpen, setMonitoringModalOpen] = useState(false)
  const [monitoringModalMode, setMonitoringModalMode] = useState<"add" | "edit" | "view">("add")
  const [monitoringModalIndex, setMonitoringModalIndex] = useState<number | null>(null)
  const [monitoringDraft, setMonitoringDraft] = useState<MonitoringRecord>(emptyMonitoringRecord)
  const backendJusticeDraft = draftObject(row.intakeDraft?.justice_draft)
  const emptyJusticeDraft = (): JusticeDraft => ({
    courtOrders: [],
  })
  const [justice, setJustice] = useState<JusticeDraft>({ ...emptyJusticeDraft(), ...backendJusticeDraft, courtOrders: draftArray(backendJusticeDraft.courtOrders) as CourtOrderRecord[] })
  const emptyCourtOrderDraft = (): CourtOrderRecord => ({ id: `court-order-${Date.now()}`, courtOrderType: "", courtName: "", courtCaseNumber: "", dateIssued: "", expiryDate: "", status: "Active", courtDecision: "", notes: "" })
  const [courtOrderModalOpen, setCourtOrderModalOpen] = useState(false)
  const [courtOrderModalIndex, setCourtOrderModalIndex] = useState<number | null>(null)
  const [courtOrderDraft, setCourtOrderDraft] = useState<CourtOrderRecord>(emptyCourtOrderDraft)
  const [registeredCourts, setRegisteredCourts] = useState<SetupRecord[]>([])
  const phaseTabs = [
    ["details", "Case Details"],
    ["assessment", "Assessment"],
    ["care", "Care Plan"],
    ["justice", "Court Orders"],
    ["referrals", "Referrals"],
    ["interventions", "Implementation"],
    ["monitoring", "Monitoring"],
    ["notes", "Case Notes"],
    ["attachments", "Attachments"],
    ["closure", "Closure"],
  ]
  const districtPlacesOfSafety = registeredPlacesOfSafety
    .filter((place) => place.districtName === row.district && place.status !== "Inactive" && Boolean(place.partner_name))
    .sort((left, right) => (left.partner_name || "").localeCompare(right.partner_name || ""))
  const placeOfSafetySuggestionsId = `places-of-safety-${row.backendIntakeId || row.id}`
  const districtCourtNames = registeredCourts
    .filter((court) => court.districtName === row.district && court.status !== "Inactive" && Boolean(court.court_name))
    .map((court) => court.court_name as string)
    .filter((courtName, index, items) => items.indexOf(courtName) === index)
    .sort((left, right) => left.localeCompare(right))
  const courtNameSuggestionsId = `registered-courts-${row.backendIntakeId || row.id}`

  useEffect(() => {
    if (!courtOrderModalOpen) return
    let active = true
    apiGet<SetupRecord[]>("/courts/")
      .then((courts) => { if (active) setRegisteredCourts(courts) })
      .catch(() => { if (active) setRegisteredCourts([]) })
    return () => { active = false }
  }, [courtOrderModalOpen])

  useEffect(() => {
    if (!referralModalOpen || referralDraft.type !== "Place of Safety") return
    let active = true
    apiGet<SetupRecord[]>("/partners-in-district/?type=Place%20of%20Safety")
      .then((places) => { if (active) setRegisteredPlacesOfSafety(places) })
      .catch(() => { if (active) setRegisteredPlacesOfSafety([]) })
    return () => { active = false }
  }, [referralModalOpen, referralDraft.type])
  const courtOrderTypes = ["Ministerial Order", "Criminal Court Order", "Juvenile / Child Court Order", "Defacto Adoption", "Non Defacto Adoption", "Foster Care Order", "Other"]
  const needs = ["Food Support", "Education Support", "Medical Assistance", "Birth Registration", "Counselling", "Mental Health Support", "Shelter", "Disability Support", "Legal Support", "Financial Assistance", "Family Reintegration", "Transport Support", "Other"]
  const referralTypes = ["Medical", "Police/VFU", "Place of Safety", "Counselling", "Legal", "Education", "NGO", "Birth Registration", "Food Support", "Other"]
  const carePlanStatuses = ["Planned", "In Progress", "Completed", "Cancelled"]
  const serviceStatuses = ["Planned", "Referred", "In Progress", "Completed", "Cancelled"]
  const documentTypes = ["Medical Report", "Referral Letter", "Court Order", "Consent Form", "School Letter", "Photo", "Other"]
  const lifecycleDeadlines = workflowDeadlines(row.sourceAlert?.submittedAt || row.createdAt, Date.now(), row.assessmentStartedAt || row.allocatedAt || "")
  const todayIso = new Date().toISOString().slice(0, 10)
  const interventionTasks = careRows.map((item, index) => serviceRows[index] || normalizeServiceTrackingRow({}, item))
  const activeInterventions = interventionTasks.filter((service) => !["Completed", "Cancelled"].includes(service.status))
  const recordedReferrals = referrals.filter(hasRecordedReferralData)
  const carePlanActivityLabel = (item: CarePlanRow) => item.assistanceType || item.plannedAction
  const carePlanRequiresReferral = (item: CarePlanRow) => item.referralRequired === "Yes"
  const referralForCarePlanItem = (item: CarePlanRow) => recordedReferrals.find((referral) => referral.linkedCarePlanItem === carePlanActivityLabel(item))
  const validReferralForCarePlanItem = (item: CarePlanRow) => recordedReferrals.find((referral) => referral.linkedCarePlanItem === carePlanActivityLabel(item))
  const outstandingReferralItems = careRows.filter((item) => carePlanRequiresReferral(item) && !validReferralForCarePlanItem(item))
  const providerForCarePlanItem = (item: CarePlanRow) => {
    const referral = referralForCarePlanItem(item)
    if (!referral) return null
    return { agency: referral.referralAgency || referral.referredTo || "Provider not captured" }
  }
  const serviceModalCareItem = serviceModalIndex === null ? undefined : careRows[serviceModalIndex]
  const serviceModalProvider = serviceModalCareItem ? providerForCarePlanItem(serviceModalCareItem) : null
  const visibleReferrals = referrals.map((referral, index) => ({ referral, index })).filter(({ referral }) => hasRecordedReferralData(referral))
  const overdueReferrals = recordedReferrals.filter((referral) => referral.followUpDate && referral.followUpDate < todayIso)
  const serviceStarted = recordedReferrals.length > 0 || interventionTasks.some((service) => service.implementationNotes || service.status !== "Planned")
  const latestMonitoringRecord = monitoringRecords[monitoringRecords.length - 1]
  const monitoringStarted = Boolean(monitoringRecords.length || monitoring.currentSituation || monitoring.progress || monitoring.challenges || monitoring.progressSummary || monitoring.nextVisitDate)
  const closureSubmitted = closureStatus === "Submitted" || caseStatus === "Closure Recommended"
  const capturedCaseDocuments: DisplayAttachmentRow[] = caseDocuments
    .map((document, index) => ({ ...document, source: "case" as const, sourceLabel: "Case file", originalIndex: index }))
    .filter((document) => Boolean(document.fileName || document.previewUrl || document.notes?.trim()))
  const visibleAttachments = [...capturedCaseDocuments]
  const workflowItems = [
    { label: "Alert Raised", state: "done" },
    { label: "Intake Completed", state: "done" },
    { label: "Screened", state: "done" },
    { label: "Allocated", state: row.status === "Allocated" ? "done" : "current" },
    { label: "Assessment", state: assessmentStatus === "Completed" ? "done" : assessmentStatus === "In Progress" ? "current" : "pending" },
    { label: "Care Plan", state: ["Completed", "Submitted", "Approved", "Approved with Comments"].includes(carePlanStatus) ? "done" : careRows.length || caseStatus === "Care Plan Draft" ? "current" : "pending" },
    { label: "Services", state: serviceStarted ? "current" : "pending" },
    { label: "Monitoring", state: monitoringStarted ? "current" : "pending" },
    { label: "Closure", state: closureSubmitted ? "done" : monitoring.closureSummary || caseStatus === "Closure Recommended" ? "current" : "pending" },
  ]
  useEffect(() => {
    apiGet<IntakeUpdateRequest[]>("/update-requests/")
      .then((items) => setChangeRequests(items.filter((item) => item.intake === row.backendIntakeId || item.caseReference === row.id)))
      .catch(() => setChangeRequests([]))
  }, [row.backendIntakeId, row.id])

  const selectedChangeRequest = changeRequests.find((request) => request.id === selectedChangeRequestId)

  function changeRequestNumber(request: IntakeUpdateRequest) {
    return `CR-${String(request.id).padStart(3, "0")}`
  }

  function changeRequestFields(request: IntakeUpdateRequest) {
    return request.requested_fields.map((field) => ({
      label: field.label || field.path,
      oldValue: field.old_value || field.current_value || "Not captured",
      newValue: field.new_value || field.proposed_value || "Not captured",
    }))
  }

  function openChangeRequests() {
    setSelectedChangeRequestId(null)
    setChangeRequestsOpen(true)
  }

  function openChangeRequestDetails(request: IntakeUpdateRequest) {
    setSelectedChangeRequestId(request.id)
  }

  type CaseTimelineEvent = {
    category: "Workflow" | "Referrals" | "Monitoring" | "Change Requests" | "Closure"
    date: string
    title: string
    detail: string
    status?: string
  }

  function addTimelineEvent(events: CaseTimelineEvent[], category: CaseTimelineEvent["category"], date: string | undefined | null, title: string, detail: string, status?: string) {
    if (!date) return
    events.push({ category, date, title, detail, status })
  }

  function caseTimelineEvents() {
    const events: CaseTimelineEvent[] = []
    addTimelineEvent(events, "Workflow", row.sourceAlert?.submittedAt || row.createdAt, "Alert Raised", row.sourceAlertId ? `${row.sourceAlertId} reported` : "Manual case created")
    addTimelineEvent(events, "Workflow", row.createdAt, "Intake Created", `${row.id} opened for intake`)
    addTimelineEvent(events, "Workflow", row.screeningCompletedAt || row.submittedForReviewAt, "Screening Submitted", row.intakeOfficer || "Intake officer")
    addTimelineEvent(events, "Workflow", row.submittedForReviewAt, "District Allocation Decision", row.status === "Allocated" || row.status === "Approved for Allocation" ? "DSDO acceptance recorded" : "Awaiting DSDO allocation")
    addTimelineEvent(events, "Workflow", row.allocatedAt, "Allocated", row.allocatedOfficer || "Allocated officer not captured")
    addTimelineEvent(events, "Workflow", row.assessmentStartedAt || row.allocatedAt, "Assessment Started", row.allocatedOfficer || "Allocated officer")
    addTimelineEvent(events, "Workflow", row.assessmentCompletedAt, "Assessment Completed", assessmentStatus || "Submitted")
    addTimelineEvent(events, "Workflow", row.assessmentCarePlanSubmittedAt, "Care Plan Submitted", carePlanStatus || "Submitted")
    if (["Approved", "Approved with Comments"].includes(carePlanStatus)) addTimelineEvent(events, "Workflow", row.intakeDraft?.assessment_care_plan_reviewed_at || row.assessmentCarePlanSubmittedAt, "Care Plan Approved", carePlanStatus)
    recordedReferrals.forEach((referral) => {
      addTimelineEvent(events, "Referrals", referral.date, `Referral Created - ${referral.referredTo || referral.type || "Provider not captured"}`, referral.reason || referral.type || "Referral created", "Recorded")
    })
    monitoringRecords.forEach((record) => {
      addTimelineEvent(events, "Monitoring", record.recordedAt || record.followUpDate, `${record.followUpType || "Monitoring Visit"} Conducted`, record.overallFindings || record.location || "Monitoring recorded", record.overallOutcome)
      addTimelineEvent(events, "Monitoring", record.nextFollowUpDate, "Follow-up Due", record.recommendedNextStep || "Next monitoring follow-up")
    })
    caseReviews.forEach((review) => addTimelineEvent(events, "Monitoring", review.createdAt || review.reviewDate, "Case Review Completed", review.finalDecision || review.outcome || "Case review recorded", review.status))
    changeRequests.forEach((request) => {
      addTimelineEvent(events, "Change Requests", request.requested_at, "Intake Change Requested", `${changeRequestNumber(request)} | ${request.tab} | ${request.reason}`, request.status)
      if (request.reviewed_at) addTimelineEvent(events, "Change Requests", request.reviewed_at, `Intake Change ${request.status}`, request.review_notes || request.reviewedByName || "Supervisor review recorded", request.status)
    })
    addTimelineEvent(events, "Closure", closureDraft.recommendedAt, "Closure Requested", closureDraft.currentSituation || "Closure request drafted", closureStatus)
    if (closureStatus === "Approved" || row.closureStatus === "Approved") addTimelineEvent(events, "Closure", row.intakeDraft?.closure_reviewed_at || closureDraft.recommendedAt, "Case Closure Approved", closureDraft.decision || "Closure approved", "Approved")
    return events.sort((a, b) => parseWorkflowDate(a.date).getTime() - parseWorkflowDate(b.date).getTime())
  }
  const caseHealthItems = [
    ["Assessment overdue", row.assessmentSlaStatus === "Overdue" ? "Yes" : "No"],
    ["High risk", ["HIGH", "CRITICAL"].includes(row.riskLevel.toUpperCase()) ? "Yes" : "No"],
    ["Pending referrals", `${outstandingReferralItems.length}`],
    ["Next action", caseStatus === "Allocated" ? "Start assessment" : nextAllocatedAction(row)],
    ["Allocation delay", row.allocationDelaySeconds == null ? row.allocationDelayStatus || "Awaiting allocation" : formatDuration(row.allocationDelaySeconds)],
    ["Supervisor review", row.caseReviewStatus || "Review due every 20 days"],
    ["Days open", daysSince(row.createdAt)],
  ]
  const recordedCaseNotes = caseNotes.filter(hasMeaningfulCaseNote)
  const recentCaseNotes = caseNotes.slice(-3).map((note, offset) => ({ note, index: caseNotes.length - Math.min(3, caseNotes.length) + offset })).reverse()
  const meaningfulCareRows = careRows.filter((item) => Boolean(item.assistanceType || item.plannedAction || item.actionPlanNotes))
  const meaningfulImplementationTasks = interventionTasks.filter((item) => Boolean(item.plannedAction || item.implementationNotes))
  const narrativeComplete = (key: AssessmentNarrativeKey) => Boolean(assessment[key].trim())
  const assessmentDetailsFields = [
    { key: "assessmentDate", label: "Assessment Date", value: assessment.assessmentDate }, { key: "assessmentType", label: "Assessment Type", value: assessment.assessmentType }, { key: "assessmentLocation", label: "Assessment Location", value: assessment.assessmentLocation },
    { key: "childSeen", label: "Child Seen", value: assessment.childSeen }, { key: "parentCarerSeen", label: "Parent/Carer Seen", value: assessment.parentCarerSeen }, { key: "personsInterviewed", label: "Persons Interviewed", value: assessment.personsInterviewed.length ? "recorded" : "" },
    ...(assessment.personsInterviewed.includes("Other") ? [{ key: "otherPersonInterviewed", label: "Other Person Interviewed", value: assessment.otherPersonInterviewed }] : []),
  ]
  const assessmentDetailsMissingFields = assessmentDetailsFields.filter(({ value }) => !`${value || ""}`.trim())
  const assessmentDetailsMissing = assessmentDetailsMissingFields.map(({ label }) => label)
  const milestonesComplete = Boolean(assessment.milestones.length || assessment.milestonesAssessmentNotes.trim())
  const substantiveAssessmentStages = [
    { label: "Assessment Details", required: assessmentDetailsMissing, completedFields: assessmentDetailsFields.length - assessmentDetailsMissing.length, totalFields: assessmentDetailsFields.length },
    { label: "The Child's Developmental Needs", required: [], completedFields: childDevelopmentAssessmentSections.filter(({ key }) => narrativeComplete(key)).length, totalFields: childDevelopmentAssessmentSections.length },
    { label: "Parent/Carers Capacity", required: [], completedFields: parentCarerAssessmentSections.filter(({ key }) => narrativeComplete(key)).length, totalFields: parentCarerAssessmentSections.length },
    { label: "Environmental Factors", required: [], completedFields: environmentalAssessmentSections.filter(({ key }) => narrativeComplete(key)).length, totalFields: environmentalAssessmentSections.length },
  ].map((stage, index) => ({ ...stage, complete: completedAssessmentSteps.includes(index) || (stage.totalFields > 0 && stage.completedFields === stage.totalFields) }))
  const assessmentStages = [...substantiveAssessmentStages, { label: "Review Assessment", required: substantiveAssessmentStages.flatMap((stage) => stage.required), completedFields: 0, totalFields: 0, complete: substantiveAssessmentStages.every((stage) => stage.complete) }]
  const assessmentProgressStatus = assessmentStatus === "Submitted" ? "Submitted" : substantiveAssessmentStages.some((stage) => stage.completedFields) ? "In Progress" : "Not Started"
  const todayStart = new Date(`${todayIso}T00:00:00`).getTime()
  const carePlanStarted = Boolean(meaningfulCareRows.length || carePlanChildStory.trim() || carePlanStatus !== "Draft")
  const reviewStarted = Boolean(monitoring.progressSummary || monitoring.supervisorComments || supervisorReviewNotes || supervisorReviewDecision !== "Continue case")
  const closureStarted = Boolean(monitoring.closureSummary || monitoring.recommendation || closureStatus !== "Not Requested")
  const lastCaseNote = recordedCaseNotes[recordedCaseNotes.length - 1]
  const lastUploadedAttachment = visibleAttachments[visibleAttachments.length - 1]
  const completedTasks = meaningfulImplementationTasks.filter((item) => item.status === "Completed")
  const inProgressTasks = meaningfulImplementationTasks.filter((item) => ["Planned", "Referred", "In Progress"].includes(item.status))
  const monitoringFollowUpAllowed = meaningfulImplementationTasks.some((item) => ["Referred", "In Progress", "Completed"].includes(item.status))
  const followUpCarePlanOptions = careRows.flatMap((item, index) => {
    const service = interventionTasks[index]
    if (!service || !["Referred", "In Progress", "Completed"].includes(service.status)) return []
    const label = item.assistanceType === "Other" && item.otherAssistanceDescription ? `Other: ${item.otherAssistanceDescription}` : item.assistanceType || item.plannedAction || `Care plan activity ${index + 1}`
    return [{ label, value: service.plannedAction || item.assistanceType || item.plannedAction || label, status: service.status }]
  })
  const delayedTasks = careRows.filter((item, index) => item.dueDate && !["Completed", "Cancelled"].includes(interventionTasks[index]?.status || "Planned") && new Date(`${item.dueDate}T00:00:00`).getTime() < todayStart)
  const overdueCareItems = meaningfulCareRows.filter((item) => item.dueDate && !["Completed", "Cancelled"].includes(item.status) && new Date(`${item.dueDate}T00:00:00`).getTime() < todayStart)
  const missingRequiredDocuments = ["Assessment Document"].filter((documentType) => !visibleAttachments.some((attachment) => attachment.documentType === documentType || attachment.fileName.toLowerCase().includes(documentType.toLowerCase().replace(" document", ""))))

  function dueCardStatus(dateValue?: string | null, completed = false): Pick<TimelineCard, "status" | "tone"> {
    if (completed) return { status: "Completed", tone: "review" }
    if (!dateValue) return {}
    const due = parseWorkflowDate(dateValue).getTime()
    if (!Number.isFinite(due)) return {}
    const diffMs = due - Date.now()
    if (diffMs < 0) return { status: "Overdue", tone: "danger" }
    if (diffMs <= 3 * 86400000) return { status: "Due soon", tone: "warning" }
    return { status: "On track", tone: "review" }
  }

  function nextDueDate(items: Array<{ dueDate?: string; followUpDate?: string; status?: string }>) {
    return items
      .filter((item) => !["Completed", "Failed", "Cancelled"].includes(item.status || "") && (item.dueDate || item.followUpDate))
      .map((item) => item.dueDate || item.followUpDate || "")
      .sort()[0] || ""
  }

  function formatTimelineDate(value?: string | null) {
    return value ? formatWorkflowDateTime(value) : "Not recorded"
  }

  function card(label: string, value: string | number, meta: Pick<TimelineCard, "status" | "tone"> = {}): TimelineCard {
    return { label, value: `${value || "Not recorded"}`, ...meta }
  }

  function timelineCardsForTab(): { cards: TimelineCard[]; empty?: string } {
    if (activeTab === "assessment") {
      if (!substantiveAssessmentStages.some((stage) => stage.completedFields)) return { cards: [], empty: "No assessment activity yet." }
      return {
        cards: [
          card("Assessment Started", formatTimelineDate(row.assessmentStartedAt || row.allocatedAt || "")),
          card("Last Assessment Update", formatTimelineDate(row.assessmentStartedAt || row.allocatedAt || row.createdAt)),
        ],
      }
    }
    if (activeTab === "care") {
      if (!carePlanStarted) return { cards: [], empty: "No care plan has been created yet." }
      const nextCareDue = nextDueDate(meaningfulCareRows)
      return {
        cards: [
          card("Care Plan Created", meaningfulCareRows.length ? formatTimelineDate(row.assessmentStartedAt || row.allocatedAt || row.createdAt) : "Not recorded"),
          card("Care Plan Submitted", carePlanStatus === "Submitted" ? "Submitted" : "Not submitted"),
          card("Approval Status", carePlanStatus),
          card("Active Care Plan Items", meaningfulCareRows.filter((item) => !["Completed", "Cancelled"].includes(item.status)).length),
          card("Next Care Plan Item Due", nextCareDue ? formatTimelineDate(nextCareDue) : "Not scheduled", dueCardStatus(nextCareDue)),
          card("Overdue Care Plan Items", overdueCareItems.length, overdueCareItems.length ? { status: "Overdue", tone: "danger" } : { status: "Clear", tone: "review" }),
        ],
      }
    }
    if (activeTab === "referrals") {
      if (!recordedReferrals.length) return { cards: [], empty: "No referrals have been recorded for this case." }
      const nextReferralDue = nextDueDate(recordedReferrals)
      return {
        cards: [
          card("Total Referrals", recordedReferrals.length),
          card("Required Referrals Outstanding", outstandingReferralItems.length),
          card("Follow-ups Scheduled", recordedReferrals.filter((referral) => Boolean(referral.followUpDate)).length),
          card("Overdue Follow-ups", overdueReferrals.length, overdueReferrals.length ? { status: "Overdue", tone: "danger" } : { status: "Clear", tone: "review" }),
          card("Feedback Recorded", recordedReferrals.filter((referral) => Boolean(referral.outcome.trim())).length),
          card("Next Referral Follow-up Due", nextReferralDue ? formatTimelineDate(nextReferralDue) : "Not scheduled", dueCardStatus(nextReferralDue)),
        ],
      }
    }
    if (activeTab === "interventions") {
      if (!meaningfulImplementationTasks.length) return { cards: [], empty: "No implementation tasks have been generated from the care plan." }
      const nextTaskDue = nextDueDate(careRows.filter((item, index) => !["Completed", "Cancelled"].includes(interventionTasks[index]?.status || "Planned")))
      return {
        cards: [
          card("Total Implementation Tasks", meaningfulImplementationTasks.length),
          card("Completed Tasks", completedTasks.length, completedTasks.length ? { status: "Completed", tone: "review" } : {}),
          card("In Progress Tasks", inProgressTasks.length),
          card("Delayed Tasks", delayedTasks.length, delayedTasks.length ? { status: "Delayed", tone: "danger" } : { status: "On track", tone: "review" }),
          card("Next Task Due", nextTaskDue ? formatTimelineDate(nextTaskDue) : "Not scheduled", dueCardStatus(nextTaskDue)),
          card("Overdue Tasks", delayedTasks.length, delayedTasks.length ? { status: "Overdue", tone: "danger" } : { status: "Clear", tone: "review" }),
        ],
      }
    }
    if (activeTab === "notes") {
      if (!recordedCaseNotes.length) return { cards: [], empty: "No case notes have been recorded yet." }
      const significantEvents = recordedCaseNotes.filter((note) => /critical|emergency|risk|unsafe|abuse|violence/i.test(note.caseNote)).length
      return {
        cards: [
          card("Total Case Notes", recordedCaseNotes.length),
          card("Latest Case Note", lastCaseNote?.caseNote || "Not recorded"),
          card("Significant Events Count", significantEvents, significantEvents ? { status: "Review", tone: "warning" } : { status: "Clear", tone: "review" }),
        ],
      }
    }
    if (activeTab === "attachments") {
      if (!visibleAttachments.length) return { cards: [], empty: "No attachments have been uploaded yet." }
      return {
        cards: [
          card("Total Attachments", visibleAttachments.length),
          card("Last Uploaded", lastUploadedAttachment?.fileName || "Not recorded"),
          card("Uploaded By", lastUploadedAttachment?.sourceLabel || "Not recorded"),
          card("Required Documents Missing", missingRequiredDocuments.length ? missingRequiredDocuments.join(", ") : "None", missingRequiredDocuments.length ? { status: "Missing", tone: "warning" } : { status: "Complete", tone: "review" }),
          card("Verification Status", "Pending verification", { status: "Review", tone: "warning" }),
        ],
      }
    }
    if (activeTab === "monitoring") {
      const newRisks = latestMonitoringRecord ? latestMonitoringRecord.newRisksIdentified === "Yes" : Boolean(monitoring.newRisks && !/^no$/i.test(monitoring.newRisks.trim()))
      const childUnsafe = latestMonitoringRecord ? latestMonitoringRecord.childSafe === "No" : /unsafe|not safe/i.test(monitoring.currentSituation)
      const latestOutcome = latestMonitoringRecord?.overallOutcome || monitoring.progressOutcome
      const nextFollowUp = latestMonitoringRecord?.nextFollowUpDate || monitoring.nextVisitDate
      return {
        cards: [
          card("Follow-ups", monitoringRecords.length),
          card("Latest Outcome", latestMonitoringRecord?.overallOutcome || "Not recorded", /worsening|deteriorating/i.test(latestOutcome) ? { status: "Warning", tone: "warning" } : {}),
          card("Child Safe", latestMonitoringRecord?.childSafe || "Not confirmed", childUnsafe ? { status: "Critical", tone: "danger" } : {}),
          card("Next Follow-up", nextFollowUp || "Not scheduled", dueCardStatus(nextFollowUp)),
          card("Monitoring Status", childUnsafe ? "Critical" : newRisks ? "Needs review" : "On Track", childUnsafe ? { status: "Critical", tone: "danger" } : newRisks ? { status: "Warning", tone: "warning" } : { status: "On track", tone: "review" }),
          card("New Risks", newRisks ? "Yes" : "No", newRisks ? { status: "Warning", tone: "warning" } : { status: "Clear", tone: "review" }),
        ],
      }
    }
    if (activeTab === "review") {
      if (!reviewStarted) return { cards: [], empty: "No case review has been recorded yet." }
      return {
        cards: [
          card("Last Case Review", formatTimelineDate(monitoring.reviewDate)),
          card("Next Review Due", row.caseReviewDueAt ? formatTimelineDate(row.caseReviewDueAt) : "Not scheduled", dueCardStatus(row.caseReviewDueAt)),
          card("Review Status", row.caseReviewStatus || "Draft"),
          card("Care Plan Progress Summary", monitoring.progressSummary || "Not recorded"),
          card("Review Outcome", monitoring.progressOutcome || "Not recorded"),
          card("Supervisor Decision", supervisorReviewDecision || "Not recorded"),
        ],
      }
    }
    if (activeTab === "closure") {
      return {
        cards: [
          card("Closure Readiness", closureBlockingReasons().length ? "Not Ready" : "Ready"),
          card("Outstanding Risks", closureBlockingReasons().length ? closureBlockingReasons().length : "None"),
          card("Pending Actions", activeInterventions.length, activeInterventions.length ? { status: "Open", tone: "warning" } : { status: "Clear", tone: "review" }),
          card("Last Monitoring Outcome", latestMonitoringRecord?.overallOutcome || "Not recorded"),
          card("Last Review Outcome", caseReviews[caseReviews.length - 1]?.outcome || "Not recorded"),
          card("Pending Referrals", outstandingReferralItems.length),
        ],
      }
    }
    return {
      cards: [
        card("Referral Received", formatTimelineDate(row.sourceAlert?.submittedAt || row.createdAt)),
        card("Intake Completed", formatTimelineDate(row.createdAt)),
        card("Screening Completed", formatTimelineDate(row.submittedForReviewAt || row.createdAt)),
        card("Allocated", formatTimelineDate(allocatedDate(row))),
        card("Assessment Timer Started", formatTimelineDate(row.assessmentStartedAt || row.allocatedAt || "")),
        card("Next Supervisor Review Due", row.caseReviewDueAt ? formatTimelineDate(row.caseReviewDueAt) : "Not scheduled", dueCardStatus(row.caseReviewDueAt)),
        card("Assessment Activity", assessmentStatus !== "Not Started" ? assessmentStatus : "No assessment activity"),
        card("Referral / Service Activity", serviceStarted ? "Activity recorded" : "No activity recorded"),
      ],
    }
  }

  const timelinePanel = timelineCardsForTab()
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

  async function saveExecutionDraft(successMessage = "Case draft saved.", completeAssessment = false, overrides: { referrals?: ReferralRow[]; serviceRows?: ServiceTrackingRow[]; carePlanCompleted?: boolean } = {}) {
    if (!row.backendIntakeId) {
      setMessage("Draft saved locally. Backend intake record is not linked yet.")
      return false
    }
    try {
      const cleanAssessment = assessment
      const updated = await apiPost<IntakeRecord>(`/intakes/${row.backendIntakeId}/save-execution-draft/`, {
        assessment: cleanAssessment,
        assessment_completed: completeAssessment,
        care_plan_completed: overrides.carePlanCompleted === true,
        care_plan: carePlanPayload(),
        care_plan_versions: carePlanVersions,
        care_plan_change_logs: carePlanChangeLogs,
        case_conferences: caseConferences,
        justice,
        referrals: overrides.referrals ?? referrals,
        service_tracking: overrides.serviceRows ?? serviceRows,
        case_notes: caseNotes,
        case_documents: caseDocuments,
        monitoring_followups: monitoringRecords,
        case_reviews: caseReviews,
      })
      row.intakeDraft = updated
      if (updated.assessment_completed_at) row.assessmentCompletedAt = updated.assessment_completed_at
      setCarePlanStatus(updated.assessment_care_plan_status || carePlanStatus)
      setMessage(successMessage)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save case draft to the backend.")
      return false
    }
  }

  async function persistAssessmentAutosave() {
    if (!canManage || !row.backendIntakeId || !assessmentHydratedRef.current || assessmentIsCompleted) return
    const payload = latestAssessmentRef.current
    const signature = JSON.stringify(payload)
    if (signature === lastAssessmentAutosavePayloadRef.current) return
    if (assessmentSaveInFlightRef.current) {
      assessmentSavePendingRef.current = true
      return
    }
    assessmentSaveInFlightRef.current = true
    setWorkspaceAutosave("Saving assessment...")
    try {
      const updated = await apiPatch<IntakeRecord>(`/intakes/${row.backendIntakeId}/`, { assessment_draft: payload })
      row.intakeDraft = updated
      lastAssessmentAutosavePayloadRef.current = signature
      const savedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      setWorkspaceAutosave(`Assessment saved ${savedAt}`)
    } catch (error) {
      setWorkspaceAutosave("Assessment autosave failed — changes remain in this browser")
    } finally {
      assessmentSaveInFlightRef.current = false
      if (assessmentSavePendingRef.current) {
        assessmentSavePendingRef.current = false
        window.setTimeout(() => void persistAssessmentAutosave(), 0)
      }
    }
  }

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(workspaceDraftKey)
      if (!saved) {
        assessmentHydratedRef.current = true
        return
      }
      const draft = JSON.parse(saved) as {
        activeTab?: string
        completedAssessmentSteps?: number[]
        caseStatus?: string
        assessmentStatus?: string
        carePlanStatus?: string
        closureStatus?: string
        supervisorReviewNotes?: string
        supervisorReviewDecision?: string
        assessment?: typeof assessment
        carePlanChildStory?: string
        caseConferenceHeld?: string
        careRows?: CarePlanRow[]
        carePlanVersions?: CarePlanVersion[]
        carePlanChangeLogs?: CarePlanChangeLog[]
        caseConferences?: CaseConferenceRecord[]
        justice?: JusticeDraft
        caseReviews?: CaseReviewRecord[]
        reviewLinkedRevisionId?: string
        closureDraft?: ClosureRecord
        closureHistory?: ClosureRecord[]
        referrals?: typeof referrals
        serviceRows?: ServiceTrackingRow[]
        caseNotes?: typeof caseNotes
        caseDocuments?: CaseDocumentRow[]
        monitoringRecords?: MonitoringRecord[]
        monitoring?: typeof monitoring
        savedAt?: string
        savedAtIso?: string
      }
      if (Array.isArray(draft.completedAssessmentSteps)) setCompletedAssessmentSteps(draft.completedAssessmentSteps.filter((step) => Number.isInteger(step) && step >= 0 && step < 4))
      if (draft.caseStatus && !row.assessmentCompletedAt) setCaseStatus(draft.caseStatus)
      if (draft.assessmentStatus && !row.assessmentCompletedAt) setAssessmentStatus(draft.assessmentStatus)
      // Workflow decisions belong to the backend. A browser draft may contain
      // the older `Submitted` value saved before the DSDO reviewed the case;
      // restoring it would relock an already-approved workspace. Only purely
      // local placeholder cases may recover these status fields.
      if (!row.backendIntakeId && draft.carePlanStatus) setCarePlanStatus(draft.carePlanStatus)
      if (!row.backendIntakeId && draft.closureStatus) setClosureStatus(draft.closureStatus)
      if (draft.supervisorReviewNotes) setSupervisorReviewNotes(draft.supervisorReviewNotes)
      if (draft.supervisorReviewDecision) setSupervisorReviewDecision(draft.supervisorReviewDecision)
      const backendUpdatedAt = row.intakeDraft?.updated_at ? new Date(row.intakeDraft.updated_at).getTime() : 0
      const localSavedAt = draft.savedAtIso ? new Date(draft.savedAtIso).getTime() : 0
      const backendHasAssessment = Object.keys(backendAssessmentDraft).length > 0
      const shouldRestoreLocalAssessment = !row.backendIntakeId || !backendHasAssessment || (localSavedAt > 0 && localSavedAt > backendUpdatedAt)
      if (draft.assessment && shouldRestoreLocalAssessment) {
        setAssessment(normalizeApprovedAssessment(draft.assessment, row))
      }
      if (draft.carePlanChildStory) setCarePlanChildStory(draft.carePlanChildStory)
      if (draft.caseConferenceHeld === "Yes" || draft.caseConferenceHeld === "No") setCaseConferenceHeld(draft.caseConferenceHeld)
      if (draft.careRows) setCareRows(normalizeCarePlanRows(draft.careRows))
      if (draft.carePlanVersions) setCarePlanVersions(draft.carePlanVersions)
      if (draft.carePlanChangeLogs) setCarePlanChangeLogs(draft.carePlanChangeLogs)
      if (draft.caseConferences) setCaseConferences(draft.caseConferences)
      if (draft.justice) setJustice(draft.justice)
      if (draft.caseReviews) setCaseReviews(draft.caseReviews)
      if (draft.reviewLinkedRevisionId) setReviewLinkedRevisionId(draft.reviewLinkedRevisionId)
      if (draft.closureDraft) setClosureDraft(draft.closureDraft)
      if (draft.closureHistory) setClosureHistory(draft.closureHistory)
      if (draft.referrals) setReferrals(draft.referrals)
      if (draft.serviceRows) setServiceRows(draft.serviceRows)
      if (draft.caseNotes) setCaseNotes(draft.caseNotes.map((note) => normalizeCaseNote(objectValue(note))).filter(hasMeaningfulCaseNote))
      if (draft.caseDocuments) setCaseDocuments(draft.caseDocuments)
      if (draft.monitoringRecords) setMonitoringRecords(draft.monitoringRecords)
      if (draft.monitoring) setMonitoring((current) => ({ ...current, ...draft.monitoring }))
      if (draft.savedAt) setWorkspaceAutosave(`Restored draft saved ${draft.savedAt}`)
    } catch {
      setWorkspaceAutosave("Autosave restore failed")
    } finally {
      assessmentHydratedRef.current = true
    }
  }, [workspaceDraftKey])

  useEffect(() => {
    if (!canManage) return
    setWorkspaceAutosave("Unsaved changes")
    const timeoutId = window.setTimeout(() => {
      const savedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      const cleanAssessment = assessment
      window.localStorage.setItem(workspaceDraftKey, JSON.stringify({
        activeTab,
        completedAssessmentSteps,
        caseStatus,
        assessmentStatus,
        carePlanStatus,
        closureStatus,
        supervisorReviewNotes,
        supervisorReviewDecision,
        assessment: cleanAssessment,
        carePlanChildStory,
        caseConferenceHeld,
        careRows,
        carePlanVersions,
        carePlanChangeLogs,
        caseConferences,
        justice,
        caseReviews,
        reviewLinkedRevisionId,
        closureDraft,
        closureHistory,
        referrals,
        serviceRows,
        caseNotes,
        caseDocuments,
        monitoringRecords,
        monitoring,
        savedAt,
        savedAtIso: new Date().toISOString(),
      }))
      setWorkspaceAutosave(`Autosaved ${savedAt}`)
      void persistAssessmentAutosave()
    }, 1200)
    return () => window.clearTimeout(timeoutId)
  }, [canManage, workspaceDraftKey, activeTab, completedAssessmentSteps, caseStatus, assessmentStatus, carePlanStatus, closureStatus, supervisorReviewNotes, supervisorReviewDecision, assessment, carePlanChildStory, caseConferenceHeld, careRows, carePlanVersions, carePlanChangeLogs, caseConferences, justice, caseReviews, reviewLinkedRevisionId, closureDraft, closureHistory, referrals, serviceRows, caseNotes, caseDocuments, monitoringRecords, monitoring])

  function setAssessmentValue(key: keyof ApprovedAssessmentDraft, value: string | string[]) {
    setAssessment((current) => {
      const next = { ...current, [key]: value }
      if (key === "childSeen" && value === "No") next.personsInterviewed = next.personsInterviewed.filter((item) => item !== "Child")
      if (key === "parentCarerSeen" && value === "No") next.personsInterviewed = next.personsInterviewed.filter((item) => !["Mother", "Father", "Guardian", "Other caregiver"].includes(item))
      return next
    })
    if (assessmentStatus === "Not Started") setAssessmentStatus("In Progress")
    if (caseStatus === "Allocated") setCaseStatus("Assessment In Progress")
    setAssessmentFieldErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    setMessage("")
  }

  function toggleAssessmentArray(key: "personsInterviewed" | "milestones", item: string) {
    setAssessment((current) => {
      const values = arrayValue(current[key])
      const selected = values.includes(item)
      const nextValues = selected ? values.filter((value) => value !== item) : [...values, item]
      const next = { ...current, [key]: nextValues }
      if (key === "personsInterviewed" && item === "Child" && !selected) next.childSeen = "Yes"
      return next
    })
    if (key === "personsInterviewed") setAssessmentFieldErrors((current) => {
      if (!current.personsInterviewed) return current
      const next = { ...current }
      delete next.personsInterviewed
      return next
    })
    if (assessmentStatus === "Not Started") setAssessmentStatus("In Progress")
  }

  function goToAssessmentStep(nextStep: number) {
    if (!canManage) {
      const targetStep = Math.max(0, Math.min(assessmentStages.length - 1, nextStep))
      setAssessmentStep(targetStep)
      setAssessmentFieldErrors({})
      setOpenAssessmentSections([
        "assessmentVisitNotes",
        "childOwnStory",
        ...childDevelopmentAssessmentSections.map(({ key }) => key),
        ...parentCarerAssessmentSections.map(({ key }) => key),
        ...environmentalAssessmentSections.map(({ key }) => key),
      ])
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }))
      return
    }
    if (nextStep > assessmentStep && assessmentStages[assessmentStep].required.length) {
      const missingFields = assessmentDetailsFields.filter(({ label }) => assessmentStages[assessmentStep].required.includes(label))
      setAssessmentFieldErrors(Object.fromEntries(missingFields.map(({ key, label }) => [key, `${label} is required.`])))
      window.requestAnimationFrame(() => {
        const firstInvalid = document.querySelector<HTMLElement>(`[data-assessment-field="${missingFields[0]?.key}"]`)
        firstInvalid?.scrollIntoView({ behavior: "smooth", block: "center" })
        firstInvalid?.querySelector<HTMLElement>("input, select, textarea, button")?.focus({ preventScroll: true })
      })
      return
    }
    const targetStep = Math.max(0, Math.min(assessmentStages.length - 1, nextStep))
    if (targetStep > assessmentStep && assessmentStep < substantiveAssessmentStages.length) {
      setCompletedAssessmentSteps((current) => current.includes(assessmentStep) ? current : [...current, assessmentStep])
    }
    setAssessmentStep(targetStep)
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }))
    setMessage("")
  }

  function selectAssessmentStep(nextStep: number) {
    const targetStep = Math.max(0, Math.min(assessmentStages.length - 1, nextStep))
    setAssessmentStep(targetStep)
    setAssessmentFieldErrors({})
    setMessage("")
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }))
  }

  function saveAssessment() {
    setAssessmentStatus("In Progress")
    setCaseStatus("Assessment In Progress")
    const savedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    const cleanAssessment = assessment
    window.localStorage.setItem(workspaceDraftKey, JSON.stringify({
      activeTab,
      completedAssessmentSteps,
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
      savedAtIso: new Date().toISOString(),
    }))
    setWorkspaceAutosave(`Draft saved ${savedAt}`)
    void saveExecutionDraft("Assessment draft saved to backend.")
  }

  function updateCareRow(index: number, key: keyof CarePlanRow, value: string) {
    setCareRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item))
    if (caseStatus === "Assessment Submitted" || caseStatus === "Assessment Approved") setCaseStatus("Care Plan Draft")
  }

  function addCareRow() {
    setCareDraft(emptyCareDraft())
    setCareModalIndex(null)
    setCareModalError("")
    setCareModalOpen(true)
  }

  function editCareRow(index: number) {
    setCareDraft(normalizeCarePlanRow(careRows[index]))
    setCareModalIndex(index)
    setCareModalError("")
    setCareModalOpen(true)
  }

  function saveCareIntervention() {
    const cleanDraft = { ...normalizeCarePlanRow(careDraft), status: "Planned" }
    if (!cleanDraft.assistanceType || (cleanDraft.assistanceType === "Other" && !cleanDraft.otherAssistanceDescription) || !cleanDraft.plannedAction || !cleanDraft.responsiblePerson || (cleanDraft.responsiblePerson === "Other" && (!cleanDraft.otherResponsiblePerson || !cleanDraft.referralRequired)) || !cleanDraft.dueDate) {
      const missing = [
        !cleanDraft.assistanceType && "Care Plan Activity",
        cleanDraft.assistanceType === "Other" && !cleanDraft.otherAssistanceDescription && "Other Assistance Description",
        !cleanDraft.plannedAction && "Activity Description",
        !cleanDraft.responsiblePerson && "Responsible Person",
        cleanDraft.responsiblePerson === "Other" && !cleanDraft.otherResponsiblePerson && "Other Responsible Person",
        cleanDraft.responsiblePerson === "Other" && !cleanDraft.referralRequired && "Referral Requirement",
        !cleanDraft.dueDate && "Target Date",
      ].filter(Boolean).join(", ")
      const error = `Complete the required fields: ${missing}.`
      setCareModalError(error)
      setMessage(error)
      return
    }
    setCareRows((current) => careModalIndex === null ? [...current, cleanDraft] : current.map((item, index) => index === careModalIndex ? cleanDraft : item))
    setServiceRows((current) => {
      if (careModalIndex === null) return [...current, normalizeServiceTrackingRow({}, cleanDraft)]
      return current.map((item, index) => index === careModalIndex ? { ...item, plannedAction: cleanDraft.assistanceType || cleanDraft.plannedAction, dueDate: cleanDraft.dueDate } : item)
    })
    if (caseStatus === "Assessment Submitted" || caseStatus === "Assessment Approved") setCaseStatus("Care Plan Draft")
    setCareModalOpen(false)
    setCareModalIndex(null)
    setCareModalError("")
    if (packageApproved && carePlanChangeMode) {
      setCarePlanChangeStage("reason")
      setCarePlanChangeRequestOpen(true)
      setMessage("Proposed care plan change prepared. Add a reason and send it to the DSDO.")
    } else {
      setMessage(careModalIndex === null ? "Care plan item added." : "Care plan item updated.")
    }
    if (cleanDraft.dueDate) void saveCaseCalendarTasks([
      caseTask(`care-plan-${careModalIndex ?? Date.now()}`, `Intervention due: ${cleanDraft.assistanceType || cleanDraft.plannedAction}`, `${row.id} | ${cleanDraft.actionPlanNotes || "Care plan action due"}`, cleanDraft.dueDate, ["HIGH", "CRITICAL"].includes(row.riskLevel.toUpperCase())),
    ], "Care plan item saved and added to the calendar.")
  }

  function removeCareRow(index: number) {
    setCareRows((current) => current.filter((_, itemIndex) => itemIndex !== index))
    setServiceRows((current) => current.filter((_, itemIndex) => itemIndex !== index))
    setMessage("Care plan item removed.")
  }

  function setCareDraftValue(key: keyof CarePlanRow, value: string) {
    setCareModalError("")
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
        return { ...current, assistanceType: value, otherAssistanceDescription: value === "Other" ? current.otherAssistanceDescription : "", requiresCourtRecommendation: needsCourt ? "Yes" : current.requiresCourtRecommendation }
      }
      if (key === "responsiblePerson") {
        const referralRequired = ["Children's Court", "NGO Partner", "Health Facility", "Police", "School"].includes(value) ? "Yes" : ["Allocated Officer", "DSDO", "CCW", "Caregiver"].includes(value) ? "No" : current.responsiblePerson === "Other" ? current.referralRequired : ""
        return { ...current, responsiblePerson: value, otherResponsiblePerson: value === "Other" ? current.otherResponsiblePerson : "", referralRequired }
      }
      return { ...current, [key]: value }
    })
  }

  function conferenceEntryCount(value: string) {
    return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean).length
  }

  function addCaseConference() {
    setCaseConferenceDraft(emptyCaseConferenceDraft())
    setCaseConferenceModalIndex(null)
    setCaseConferenceModalOpen(true)
  }

  function editCaseConference(index: number) {
    setCaseConferenceDraft(caseConferences[index])
    setCaseConferenceModalIndex(index)
    setCaseConferenceModalOpen(true)
  }

  function saveCaseConference() {
    if (!caseConferenceDraft.date || !caseConferenceDraft.participants.trim() || !caseConferenceDraft.decisions.trim()) {
      setMessage("Complete the conference date, participants and agreements.")
      return
    }
    setCaseConferences((current) => caseConferenceModalIndex === null ? [...current, caseConferenceDraft] : current.map((item, index) => index === caseConferenceModalIndex ? caseConferenceDraft : item))
    setCaseConferenceModalOpen(false)
    setMessage(caseConferenceModalIndex === null ? "Case conference recorded." : "Case conference updated.")
  }

  function removeCaseConference(index: number) {
    setCaseConferences((current) => current.filter((_, itemIndex) => itemIndex !== index))
    setMessage("Case conference removed.")
  }

  function addCourtOrder() {
    setCourtOrderDraft(emptyCourtOrderDraft())
    setCourtOrderModalIndex(null)
    setCourtOrderModalOpen(true)
  }

  function editCourtOrder(index: number) {
    setCourtOrderDraft(justice.courtOrders[index])
    setCourtOrderModalIndex(index)
    setCourtOrderModalOpen(true)
  }

  function saveCourtOrder() {
    if (!courtOrderDraft.courtOrderType || !courtOrderDraft.courtName.trim() || !courtOrderDraft.dateIssued || !courtOrderDraft.status || !(courtOrderDraft.courtDecision || "").trim()) {
      setMessage("Complete court order type, court name, date issued, status and court decision.")
      return
    }
    setJustice((current) => ({ ...current, courtOrders: courtOrderModalIndex === null ? [...current.courtOrders, courtOrderDraft] : current.courtOrders.map((order, index) => index === courtOrderModalIndex ? courtOrderDraft : order) }))
    setCourtOrderModalOpen(false)
    setMessage(courtOrderModalIndex === null ? "Court order added." : "Court order updated.")
  }

  function removeCourtOrder(index: number) {
    setJustice((current) => ({ ...current, courtOrders: current.courtOrders.filter((_, itemIndex) => itemIndex !== index) }))
    setMessage("Court order removed.")
  }

  function saveCarePlan() {
    setCarePlanStatus("Draft")
    setCaseStatus("Care Plan Draft")
    void saveExecutionDraft("Care plan draft saved to backend.")
  }

  async function completeCarePlanAndContinue() {
    if (!careRows.length) {
      setMessage("Add at least one care plan activity before continuing.")
      return
    }
    submitCarePlan()
  }

  function activeCarePlanVersion() {
    return [...carePlanVersions].reverse().find((version) => version.isActive) || carePlanVersions[carePlanVersions.length - 1]
  }

  function buildCarePlanChangeLogs(previous: CarePlanVersion | undefined, nextVersionId: string, reason: string, linkedReviewId?: string) {
    const previousItems = previous?.items || []
    const maxLength = Math.max(previousItems.length, careRows.length)
    const changes: CarePlanChangeLog[] = []
    for (let index = 0; index < maxLength; index += 1) {
      const oldItem = previousItems[index]
      const newItem = careRows[index]
      const itemName = newItem?.assistanceType || oldItem?.assistanceType || newItem?.plannedAction || oldItem?.plannedAction || `Item ${index + 1}`
      if (!oldItem && newItem) {
        changes.push({ id: `${nextVersionId}-added-${index}`, caseId: row.id, carePlanVersionId: nextVersionId, linkedReviewId, changeType: "Added", carePlanItem: itemName, fieldChanged: "Care plan item", oldValue: "N/A", newValue: newItem.plannedAction || itemName, reason, changedBy: row.allocatedOfficer || "Allocated officer", changedAt: new Date().toISOString() })
        continue
      }
      if (oldItem && !newItem) {
        changes.push({ id: `${nextVersionId}-removed-${index}`, caseId: row.id, carePlanVersionId: nextVersionId, linkedReviewId, changeType: "Removed", carePlanItem: itemName, fieldChanged: "Care plan item", oldValue: oldItem.plannedAction || itemName, newValue: "Removed", reason, changedBy: row.allocatedOfficer || "Allocated officer", changedAt: new Date().toISOString() })
        continue
      }
      if (!oldItem || !newItem) continue
      ;(["assistanceType", "plannedAction", "responsiblePerson", "dueDate", "status", "actionPlanNotes"] as Array<keyof CarePlanRow>).forEach((field) => {
        const oldValue = `${oldItem[field] || ""}`
        const newValue = `${newItem[field] || ""}`
        if (oldValue !== newValue) {
          const changeType = field === "dueDate" ? "Due Date Changed" : field === "responsiblePerson" ? "Responsible Person Changed" : field === "status" && newValue === "Cancelled" ? "Discontinued" : "Updated"
          changes.push({ id: `${nextVersionId}-${index}-${field}`, caseId: row.id, carePlanVersionId: nextVersionId, linkedReviewId, changeType, carePlanItem: itemName, fieldChanged: field, oldValue: oldValue || "N/A", newValue: newValue || "N/A", reason, changedBy: row.allocatedOfficer || "Allocated officer", changedAt: new Date().toISOString() })
        }
      })
    }
    return changes
  }

  async function saveCarePlanRevision() {
    if (!carePlanRevisionReason.trim()) {
      setMessage("Add a reason for the care plan change before saving the revision.")
      return
    }
    const previous = activeCarePlanVersion()
    const linkedReviewId = reviewLinkedRevisionId || caseReviewDraft.id
    const versionNumber = (previous?.versionNumber || 0) + 1
    const versionId = `${row.id}-care-version-${versionNumber}-${Date.now()}`
    const changes = buildCarePlanChangeLogs(previous, versionId, carePlanRevisionReason, linkedReviewId)
    if (!changes.length) {
      setMessage("No care plan changes detected to save as a revision.")
      return
    }
    const nextVersion: CarePlanVersion = { id: versionId, caseId: row.id, versionNumber, status: "Pending DSDO Approval", items: careRows, childStory: carePlanChildStory, createdBy: row.allocatedOfficer || "Allocated officer", createdAt: new Date().toISOString(), reasonForChange: carePlanRevisionReason, linkedReviewId, isActive: false }
    const nextVersions = carePlanVersions.concat(nextVersion)
    const nextLogs = [...carePlanChangeLogs, ...changes]
    setCarePlanVersions(nextVersions)
    setCarePlanChangeLogs(nextLogs)
    setReviewLinkedRevisionId(linkedReviewId)
    setCarePlanRevisionReason("")
    setCarePlanChangeRequestOpen(false)
    try {
      if (!row.backendIntakeId) throw new Error("This case is missing a backend intake reference.")
      const updated = await apiPost<IntakeRecord>(`/intakes/${row.backendIntakeId}/request-care-plan-change/`, {
        care_plan_versions: nextVersions,
        care_plan_change_logs: nextLogs,
        reason: carePlanRevisionReason.trim(),
        change_type: carePlanChangeMode,
      })
      row.intakeDraft = updated
      if (previous) {
        setCareRows(previous.items.map(normalizeCarePlanRow))
        setCarePlanChildStory(previous.childStory)
        setServiceRows((current) => previous.items.map((item, index) => normalizeServiceTrackingRow(current[index] || {}, item)))
      }
      setMessage("Care plan change request sent to the DSDO for approval. The active care plan has not been changed.")
      setCarePlanChangeMode("")
      setCarePlanChangeTargetIndex(null)
      setCarePlanChangeStage("choose")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Care plan revision saved locally, but could not sync to the backend.")
    }
  }

  function submitCarePlan() {
    if (!careRows.length) {
      setMessage("Create at least one care plan item before submission.")
      return
    }
    if (!carePlanChildStory.trim()) {
      setMessage("Capture the child's story before submitting the care plan.")
      return
    }
    void submitCarePlanForReview()
  }

  function openCarePlanChangeRequest() {
    setCarePlanChangeMode("")
    setCarePlanChangeTargetIndex(null)
    setCarePlanChangeStage("choose")
    setCarePlanRevisionReason("")
    setCarePlanChangeRequestOpen(true)
  }

  function beginCarePlanChange() {
    if (!carePlanChangeMode) {
      setMessage("Select whether to create a new activity or update an existing activity.")
      return
    }
    if (carePlanChangeMode === "update" && carePlanChangeTargetIndex === null) {
      setMessage("Select the care plan activity you want to update.")
      return
    }
    setCarePlanChangeRequestOpen(false)
    if (carePlanChangeMode === "create") addCareRow()
    else editCareRow(carePlanChangeTargetIndex as number)
  }

  async function completeAssessmentAndContinue() {
    if (!await saveExecutionDraft("Assessment completed.", true)) return
    setAssessmentStatus("Completed")
    setCaseStatus("Assessment Completed")
    setActiveTab("care")
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }))
  }

  async function submitCarePlanForReview() {
    try {
      if (!row.backendIntakeId) throw new Error("This case is missing a backend intake reference.")
      const updated = await apiPost<IntakeRecord>(`/intakes/${row.backendIntakeId}/submit-care-plan/`, {
        assessment,
        care_plan: carePlanPayload(),
        care_plan_versions: carePlanVersions,
        care_plan_change_logs: carePlanChangeLogs,
        case_conferences: caseConferences,
        justice,
        referrals,
        service_tracking: serviceRows,
        case_notes: caseNotes,
        case_documents: caseDocuments,
        monitoring_followups: monitoringRecords,
        case_reviews: caseReviews,
      })
      setCarePlanStatus(updated.assessment_care_plan_status || "Submitted")
      row.assessmentCarePlanStatus = updated.assessment_care_plan_status || "Submitted"
      row.intakeDraft = updated
      setCaseStatus("Care Plan Submitted")
      setMessage("")
      setSubmissionDialogOpen(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit care plan.")
    }
  }

  async function reviewAssessmentCarePlan(stage: "assessment" | "care_plan", decision: "approve" | "approve_with_comments" | "request_revision") {
    if (!row.backendIntakeId || approvalReviewing) return
    setApprovalReviewing(true)
    try {
      const updated = await apiPost<IntakeRecord>(`/intakes/${row.backendIntakeId}/review-assessment-care-plan/`, { stage, decision, notes: approvalReviewNotes.trim() })
      const nextStatus = updated.assessment_care_plan_status || carePlanStatus
      setCarePlanStatus(nextStatus)
      row.assessmentCarePlanStatus = nextStatus
      row.intakeDraft = updated
      setApprovalReviewNotes("")
      if (stage === "assessment" && decision !== "request_revision") {
        setApprovalDialog({ title: "Assessment approved", detail: "The assessment has been approved. The care plan still requires review before the SDO can begin implementation.", nextTab: "care" })
      } else if (stage === "care_plan" && decision !== "request_revision") {
        setApprovalDialog({ title: "Assessment and care plan approved", detail: "Both stages are approved. The SDO can now proceed with court orders, referrals, implementation, services and monitoring." })
      } else {
        setApprovalDialog({ title: "Returned for revision", detail: stage === "assessment" ? "The assessment and care plan are unlocked for the SDO to revise and resubmit." : "The care plan is unlocked for revision. The approved assessment remains read-only." })
      }
    } catch (reviewError) {
      setMessage(reviewError instanceof Error ? reviewError.message : "The review decision could not be recorded.")
    } finally {
      setApprovalReviewing(false)
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

  function latestCarePlanRevision() {
    return [...carePlanVersions].reverse().find((version) => version.reasonForChange !== "Initial care plan")
  }

  function startCaseReview() {
    const draft = emptyCaseReviewDraft()
    setCaseReviewDraft(draft)
    setReviewLinkedRevisionId("")
    setCaseReviewModalOpen(true)
    setActiveTab("review")
  }

  function setCaseReviewDraftValue(key: keyof CaseReviewRecord, value: string) {
    setCaseReviewDraft((current) => ({ ...current, [key]: value }))
  }

  function goToCarePlanForRevision() {
    const linkedReviewId = caseReviewDraft.id || `review-${Date.now()}`
    setCaseReviewDraft((current) => ({ ...current, id: linkedReviewId, status: "Draft" }))
    setReviewLinkedRevisionId(linkedReviewId)
    setCaseReviewModalOpen(false)
    setActiveTab("care")
    setMessage("Review draft preserved. Use Request Change on the Care Plan tab, then return to Case Review.")
  }

  async function saveCaseReview() {
    if (!caseReviewDraft.outcome || !caseReviewDraft.riskLevel || !caseReviewDraft.carePlanDecision || !caseReviewDraft.finalDecision || !caseReviewDraft.officerAnalysis.trim()) {
      setMessage("Complete review outcome, current risk level, care plan decision, final decision and officer analysis.")
      return
    }
    if (["Modify Existing Care Plan", "Add New Care Plan Items"].includes(caseReviewDraft.carePlanDecision) && !reviewLinkedRevisionId && !caseReviewDraft.linkedCarePlanVersionId) {
      setMessage("You selected that the care plan must be revised. Please complete and save the care plan revision before completing this case review.")
      return
    }
    const linkedRevision = carePlanVersions.find((version) => version.linkedReviewId === reviewLinkedRevisionId) || latestCarePlanRevision()
    const completedReview: CaseReviewRecord = {
      ...caseReviewDraft,
      linkedCarePlanVersionId: linkedRevision?.id || caseReviewDraft.linkedCarePlanVersionId,
      revisedCarePlanSummary: linkedRevision ? `Version ${linkedRevision.versionNumber}: ${linkedRevision.reasonForChange}` : caseReviewDraft.revisedCarePlanSummary,
      status: "Completed",
      createdAt: caseReviewDraft.createdAt || new Date().toISOString(),
    }
    const nextReviews = caseReviews.some((review) => review.id === completedReview.id) ? caseReviews.map((review) => review.id === completedReview.id ? completedReview : review) : [...caseReviews, completedReview]
    setCaseReviews(nextReviews)
    setSupervisorReviewDecision(completedReview.finalDecision)
    setSupervisorReviewNotes(completedReview.officerAnalysis)
    setCaseReviewModalOpen(false)
    try {
      if (!row.backendIntakeId) throw new Error("This case is missing a backend intake reference.")
      const updated = await apiPost<IntakeRecord>(`/intakes/${row.backendIntakeId}/supervisor-case-review/`, {
        decision: completedReview.finalDecision,
        notes: completedReview.officerAnalysis,
        case_reviews: nextReviews,
      })
      row.caseReviewDueAt = updated.case_review_due_at || row.caseReviewDueAt
      row.caseReviewStatus = updated.caseReviewStatus
      row.intakeDraft = updated
      setMessage(`Case review recorded. Next review due ${updated.case_review_due_at ? formatWorkflowDateTime(updated.case_review_due_at) : "in 20 days"}.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Case review saved locally, but could not sync to the backend.")
    }
  }

  const monitoringAreaOptions: Array<[MonitoringAreaKey, string]> = [
    ["safety", "Safety"],
    ["placement", "Placement / Shelter"],
    ["health", "Health"],
    ["education", "Education"],
    ["psychosocial", "Counselling / Psychosocial"],
    ["family", "Family Environment"],
    ["reunification", "Family Tracing / Reunification"],
    ["court", "Court Matter"],
    ["referral", "Referral"],
    ["other", "Other"],
  ]
  const personContactOptions = ["Child", "Parent/Guardian", "Caregiver", "Teacher", "Health Worker", "Community Case Worker", "Police", "Service Provider", "Other"]
  const followUpTypes = ["Home Visit", "Institution Visit", "Office Meeting", "School Visit", "Telephone Call", "Other"]
  const nextActionRequiresFollowUpDate = ["Continue Current Care Plan", "Follow Up Again"].includes(monitoringDraft.recommendedNextStep)

  function toggleMonitoringArea(area: MonitoringAreaKey) {
    setMonitoringDraft((current) => {
      const selected = current.areasMonitored.includes(area)
      const areasMonitored = selected ? current.areasMonitored.filter((item) => item !== area) : [...current.areasMonitored, area]
      const dynamicAreaResponses = { ...current.dynamicAreaResponses }
      if (selected) delete dynamicAreaResponses[area]
      else dynamicAreaResponses[area] = dynamicAreaResponses[area] || {}
      return { ...current, areasMonitored, dynamicAreaResponses }
    })
  }

  function toggleMonitoringPerson(person: string) {
    setMonitoringDraft((current) => ({ ...current, personsContacted: current.personsContacted.includes(person) ? current.personsContacted.filter((item) => item !== person) : [...current.personsContacted, person] }))
  }

  function setMonitoringDraftValue(key: keyof MonitoringRecord, value: string) {
    setMonitoringDraft((current) => {
      const next = { ...current, [key]: value }
      if (key === "overallOutcome") {
        next.suggestedNextFollowUpDate = suggestedMonitoringDate(value)
        if (!current.nextFollowUpDate || current.nextFollowUpDate === current.suggestedNextFollowUpDate) next.nextFollowUpDate = next.suggestedNextFollowUpDate
      }
      if (key === "recommendedNextStep") {
        const requiresFollowUpDate = ["Continue Current Care Plan", "Follow Up Again"].includes(value)
        next.nextFollowUpDate = requiresFollowUpDate ? current.nextFollowUpDate || current.suggestedNextFollowUpDate || suggestedMonitoringDate(current.overallOutcome) : ""
      }
      return next
    })
  }

  function setMonitoringAreaValue(area: MonitoringAreaKey, key: string, value: string) {
    setMonitoringDraft((current) => {
      const areaResponse = { ...(current.dynamicAreaResponses[area] || {}), [key]: value }
      const next = { ...current, dynamicAreaResponses: { ...current.dynamicAreaResponses, [area]: areaResponse } }
      if (area === "safety" && key === "childSafe") next.childSafe = value
      return next
    })
  }

  function openMonitoringModal(mode: "add" | "edit" | "view", index: number | null = null) {
    if (mode === "add" && !monitoringFollowUpAllowed) {
      setMessage("Follow-up becomes available when an intervention is Referred, In Progress, or Completed.")
      return
    }
    const record = index === null ? emptyMonitoringRecord() : monitoringRecords[index]
    setMonitoringDraft({ ...emptyMonitoringRecord(), ...record, dynamicAreaResponses: { ...record.dynamicAreaResponses }, personsContacted: [...record.personsContacted], areasMonitored: [...record.areasMonitored] })
    setMonitoringModalMode(mode)
    setMonitoringModalIndex(index)
    setMonitoringModalOpen(true)
    setActiveTab("monitoring")
  }

  function monitoringRecordNeedsReason(record: MonitoringRecord) {
    return record.nextFollowUpRequired === "Yes" && record.nextFollowUpDate && record.nextFollowUpDate !== record.suggestedNextFollowUpDate
  }

  async function saveMonitoringRecord(createAlert = false) {
    if (monitoringModalMode === "add" && !monitoringFollowUpAllowed) {
      setMessage("Follow-up cannot be recorded while all interventions are only Planned or Cancelled.")
      return
    }
    const errors: string[] = []
    if (!monitoringDraft.followUpDate) errors.push("Follow-up date is required.")
    if (!monitoringDraft.followUpType) errors.push("Follow-up type is required.")
    if (!monitoringDraft.carePlanItemFollowedUp) errors.push("Select the care plan activity followed up.")
    if (!monitoringDraft.overallFindings.trim()) errors.push("Follow-up findings are required.")
    if (!monitoringDraft.overallOutcome) errors.push("Overall outcome is required.")
    if (!monitoringDraft.newRisksIdentified) errors.push("New protection concerns selection is required.")
    if (monitoringDraft.newRisksIdentified === "Yes" && !monitoringDraft.newRiskDetails.trim()) errors.push("Describe the new protection concerns.")
    if (!monitoringDraft.recommendedNextStep) errors.push("Recommended next step is required.")
    if (nextActionRequiresFollowUpDate && !monitoringDraft.nextFollowUpDate) errors.push("Next follow-up date is required for the selected next action.")
    if (errors.length) {
      setMessage(errors[0])
      return
    }
    const saved: MonitoringRecord = { ...monitoringDraft, updatedAt: new Date().toISOString(), updatedBy: row.allocatedOfficer || "Allocated officer" }
    const nextMonitoringRecords = monitoringModalIndex === null ? [...monitoringRecords, saved] : monitoringRecords.map((item, index) => index === monitoringModalIndex ? saved : item)
    setMonitoringRecords(nextMonitoringRecords)
    setMonitoring((current) => ({
      ...current,
      visitDate: saved.followUpDate,
      visitType: saved.followUpType,
      currentSituation: saved.overallFindings,
      newRisks: saved.newRisksIdentified === "Yes" ? saved.newRiskDetails : "No",
      progressOutcome: saved.overallOutcome,
      nextVisitDate: saved.nextFollowUpDate,
    }))
    setCaseStatus("Monitoring Ongoing")
    setMonitoringModalOpen(false)
    const urgent = saved.overallOutcome === "Situation Worsening" || saved.newRisksIdentified === "Yes"
    try {
      if (row.backendIntakeId) {
        const cleanAssessment = assessment
        const updated = await apiPost<IntakeRecord>(`/intakes/${row.backendIntakeId}/save-execution-draft/`, {
          assessment: cleanAssessment,
          care_plan: carePlanPayload(),
          care_plan_versions: carePlanVersions,
          care_plan_change_logs: carePlanChangeLogs,
          case_conferences: caseConferences,
          justice,
          referrals,
          service_tracking: serviceRows,
          case_notes: caseNotes,
          case_documents: caseDocuments,
          monitoring_followups: nextMonitoringRecords,
          case_reviews: caseReviews,
        })
        row.intakeDraft = updated
      }
      setMessage(createAlert ? "Follow-up saved. New protection concern recorded for alert creation." : "Follow-up saved.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Monitoring follow-up saved locally, but could not sync to the backend.")
    }
    if (saved.nextFollowUpDate) void saveCaseCalendarTasks([
      caseTask(`monitoring-${saved.id}`, "Monitoring follow-up due", `${row.id} | ${saved.followUpType} | ${saved.overallOutcome}`, saved.nextFollowUpDate, urgent),
    ])
    if (saved.recommendedNextStep === "Update Care Plan") setActiveTab("care")
    if (saved.recommendedNextStep === "Create Referral") setActiveTab("referrals")
  }

  function removeMonitoringRecord(index: number) {
    setMonitoringRecords((items) => items.filter((_, itemIndex) => itemIndex !== index))
    setMessage("Monitoring follow-up removed.")
  }

  function areaLabel(area: MonitoringAreaKey) {
    return monitoringAreaOptions.find(([key]) => key === area)?.[1] || area
  }

  function areaValue(area: MonitoringAreaKey, key: string) {
    return monitoringDraft.dynamicAreaResponses[area]?.[key] || ""
  }

  function MonitoringSelect({ area, field, label, options }: { area: MonitoringAreaKey; field: string; label: string; options: string[] }) {
    return <Field label={label}><select className={inputClass} value={areaValue(area, field)} disabled={monitoringModalMode === "view"} onChange={(event) => setMonitoringAreaValue(area, field, event.target.value)}><option value="">Select</option>{options.map((item) => <option key={item}>{item}</option>)}</select></Field>
  }

  function MonitoringAreaSection({ area }: { area: MonitoringAreaKey }) {
    const readOnly = monitoringModalMode === "view"
    return (
      <section className="rounded-md border border-[#d8dee8] bg-white p-4">
        <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">{areaLabel(area)}</h4>
        <FormGrid>
          {area === "safety" && <>
            <MonitoringSelect area={area} field="childSafe" label="Is the child currently safe?" options={["Yes", "No", "Not Confirmed"]} />
            <MonitoringSelect area={area} field="immediateConcern" label="Any immediate protection concern?" options={["Yes", "No"]} />
            {(areaValue(area, "childSafe") === "No" || monitoringDraft.childSafe === "No") && <div className="md:col-span-2"><Field label="Emergency action details"><textarea className={`${inputClass} min-h-[90px] py-3`} disabled={readOnly} value={monitoringDraft.emergencyActionTaken} onChange={(event) => setMonitoringDraftValue("emergencyActionTaken", event.target.value)} /></Field></div>}
            <div className="md:col-span-2"><Field label="Safety notes"><textarea className={`${inputClass} min-h-[90px] py-3`} disabled={readOnly} value={areaValue(area, "notes")} onChange={(event) => setMonitoringAreaValue(area, "notes", event.target.value)} /></Field></div>
          </>}
          {area === "placement" && <>
            <MonitoringSelect area={area} field="stable" label="Current placement stable?" options={["Yes", "No", "Not Confirmed"]} />
            <MonitoringSelect area={area} field="type" label="Placement type" options={["Home", "Relative", "Place of Safety", "Institution", "Foster Care", "Street / Unsafe", "Other"]} />
            <div className="md:col-span-2"><Field label="Placement notes"><textarea className={`${inputClass} min-h-[90px] py-3`} disabled={readOnly} value={areaValue(area, "notes")} onChange={(event) => setMonitoringAreaValue(area, "notes", event.target.value)} /></Field></div>
          </>}
          {area === "health" && <>
            <MonitoringSelect area={area} field="status" label="Health status" options={["Good", "Fair", "Poor", "Needs urgent attention", "Not assessed"]} />
            <MonitoringSelect area={area} field="careAccessed" label="Medical care accessed?" options={["Yes", "No", "Not applicable"]} />
            <div className="md:col-span-2"><Field label="Health notes"><textarea className={`${inputClass} min-h-[90px] py-3`} disabled={readOnly} value={areaValue(area, "notes")} onChange={(event) => setMonitoringAreaValue(area, "notes", event.target.value)} /></Field></div>
          </>}
          {area === "education" && <>
            <MonitoringSelect area={area} field="attendance" label="School attendance status" options={["Attending", "Not attending", "Irregular attendance", "Not applicable"]} />
            <MonitoringSelect area={area} field="progress" label="Education progress" options={["Improving", "Stable", "No Change", "Worsening", "Not assessed"]} />
            <div className="md:col-span-2"><Field label="Education notes"><textarea className={`${inputClass} min-h-[90px] py-3`} disabled={readOnly} value={areaValue(area, "notes")} onChange={(event) => setMonitoringAreaValue(area, "notes", event.target.value)} /></Field></div>
          </>}
          {area === "psychosocial" && <>
            <MonitoringSelect area={area} field="counsellingStatus" label="Counselling status" options={["Not started", "Started", "Ongoing", "Completed", "Not applicable"]} />
            <MonitoringSelect area={area} field="wellbeing" label="Emotional wellbeing" options={["Improving", "Stable", "No Change", "Worsening", "Not assessed"]} />
            <div className="md:col-span-2"><Field label="Psychosocial notes"><textarea className={`${inputClass} min-h-[90px] py-3`} disabled={readOnly} value={areaValue(area, "notes")} onChange={(event) => setMonitoringAreaValue(area, "notes", event.target.value)} /></Field></div>
          </>}
          {area === "family" && <>
            <MonitoringSelect area={area} field="status" label="Family environment status" options={["Supportive", "Partially supportive", "Unsafe", "Conflict present", "Not assessed"]} />
            <MonitoringSelect area={area} field="cooperation" label="Caregiver cooperation" options={["Good", "Fair", "Poor", "Not applicable"]} />
            <div className="md:col-span-2"><Field label="Family environment notes"><textarea className={`${inputClass} min-h-[90px] py-3`} disabled={readOnly} value={areaValue(area, "notes")} onChange={(event) => setMonitoringAreaValue(area, "notes", event.target.value)} /></Field></div>
          </>}
          {area === "behaviour" && <>
            <MonitoringSelect area={area} field="status" label="Behaviour status" options={["Improving", "Stable", "No Change", "Worsening", "Not assessed"]} />
            <MonitoringSelect area={area} field="concerns" label="Behaviour concerns present?" options={["Yes", "No"]} />
            <div className="md:col-span-2"><Field label="Behaviour notes"><textarea className={`${inputClass} min-h-[90px] py-3`} disabled={readOnly} value={areaValue(area, "notes")} onChange={(event) => setMonitoringAreaValue(area, "notes", event.target.value)} /></Field></div>
          </>}
          {area === "reunification" && <>
            <MonitoringSelect area={area} field="status" label="Tracing / reunification status" options={["Not started", "In progress", "Family located", "Reunification started", "Reunification completed", "Not applicable"]} />
            <MonitoringSelect area={area} field="readiness" label="Reunification readiness" options={["Ready", "Not ready", "Requires further assessment", "Not applicable"]} />
            <div className="md:col-span-2"><Field label="Tracing / reunification notes"><textarea className={`${inputClass} min-h-[90px] py-3`} disabled={readOnly} value={areaValue(area, "notes")} onChange={(event) => setMonitoringAreaValue(area, "notes", event.target.value)} /></Field></div>
          </>}
          {area === "court" && <>
            <MonitoringSelect area={area} field="compliance" label="Court order compliance" options={["Compliant", "Partially compliant", "Non-compliant", "Not applicable"]} />
            <Field label="Next court-related action"><input className={inputClass} disabled={readOnly} value={areaValue(area, "nextAction")} onChange={(event) => setMonitoringAreaValue(area, "nextAction", event.target.value)} /></Field>
            <div className="md:col-span-2"><Field label="Court supervision notes"><textarea className={`${inputClass} min-h-[90px] py-3`} disabled={readOnly} value={areaValue(area, "notes")} onChange={(event) => setMonitoringAreaValue(area, "notes", event.target.value)} /></Field></div>
          </>}
          {area === "referral" && <>
            <MonitoringSelect area={area} field="outcome" label="Referral outcome" options={["Accepted", "Service provided", "Pending", "Rejected", "Failed", "Not confirmed"]} />
            <div className="md:col-span-2"><Field label="Service provider feedback"><textarea className={`${inputClass} min-h-[90px] py-3`} disabled={readOnly} value={areaValue(area, "feedback")} onChange={(event) => setMonitoringAreaValue(area, "feedback", event.target.value)} /></Field></div>
            <div className="md:col-span-2"><Field label="Referral follow-up notes"><textarea className={`${inputClass} min-h-[90px] py-3`} disabled={readOnly} value={areaValue(area, "notes")} onChange={(event) => setMonitoringAreaValue(area, "notes", event.target.value)} /></Field></div>
          </>}
          {area === "other" && <>
            <Field label="Other area name"><input className={inputClass} disabled={readOnly} value={areaValue(area, "name")} onChange={(event) => setMonitoringAreaValue(area, "name", event.target.value)} /></Field>
            <div className="md:col-span-2"><Field label="Other monitoring notes"><textarea className={`${inputClass} min-h-[90px] py-3`} disabled={readOnly} value={areaValue(area, "notes")} onChange={(event) => setMonitoringAreaValue(area, "notes", event.target.value)} /></Field></div>
          </>}
        </FormGrid>
      </section>
    )
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

  function addReferral(careItem?: CarePlanRow) {
    const draft = emptyReferralDraft()
    if (careItem) {
      draft.linkedCarePlanItem = carePlanActivityLabel(careItem)
      draft.referredTo = careItem.responsiblePerson === "Other" ? careItem.otherResponsiblePerson || "" : careItem.responsiblePerson || ""
      draft.referralAgency = draft.referredTo
      draft.reason = careItem.plannedAction
    }
    setReferralDraft(draft)
    setReferralModalIndex(null)
    setReferralActivityLocked(Boolean(careItem))
    setReferralModalOpen(true)
    setActiveTab("referrals")
  }

  function editReferral(index: number) {
    const savedReferral = referrals[index]
    setReferralDraft({ ...emptyReferralDraft(), ...savedReferral })
    setReferralModalIndex(index)
    setReferralActivityLocked(false)
    setReferralModalOpen(true)
  }

  async function saveReferral() {
    const cleanReferral = { ...referralDraft }
    delete (cleanReferral as Record<string, unknown>).followUpRequired
    delete (cleanReferral as Record<string, unknown>).follow_up_required
    delete (cleanReferral as Record<string, unknown>).status
    const missing = [
      !cleanReferral.linkedCarePlanItem && "Care Plan Activity",
      !cleanReferral.type && "Referral Type",
      !(cleanReferral.referralAgency || cleanReferral.referredTo).trim() && "Referral Agency / Referred To",
      !cleanReferral.date && "Referral Date",
      !cleanReferral.followUpDate && "Follow-up Date",
      !cleanReferral.reason.trim() && "Reason for Referral",
    ].filter(Boolean)
    if (missing.length) {
      setMessage(`Complete the required referral fields: ${missing.join(", ")}.`)
      return
    }
    const nextReferrals = referralModalIndex === null
      ? [...referrals, cleanReferral]
      : referrals.map((item, index) => index === referralModalIndex ? cleanReferral : item)
    const linkedCarePlanIndex = careRows.findIndex((item) => carePlanActivityLabel(item) === cleanReferral.linkedCarePlanItem)
    const nextServiceRows = linkedCarePlanIndex < 0
      ? serviceRows
      : careRows.map((careItem, index) => {
          if (index !== linkedCarePlanIndex) return serviceRows[index] ? normalizeServiceTrackingRow(serviceRows[index], careItem) : normalizeServiceTrackingRow({}, careItem)
          const current = serviceRows[index] ? normalizeServiceTrackingRow(serviceRows[index], careItem) : normalizeServiceTrackingRow({}, careItem)
          return { ...current, status: "Referred" }
        })
    const saved = await saveExecutionDraft("", false, { referrals: nextReferrals, serviceRows: nextServiceRows })
    if (!saved) return
    setReferrals(nextReferrals)
    setServiceRows(nextServiceRows)
    setReferralModalOpen(false)
    setReferralModalIndex(null)
    setMessage(referralModalIndex === null ? "Referral created." : "Referral updated.")
    if (cleanReferral.followUpDate) void saveCaseCalendarTasks([
      caseTask(`referral-follow-up-${referralModalIndex ?? Date.now()}`, `Follow up referral: ${cleanReferral.type}`, `${row.id} | ${cleanReferral.referralAgency || cleanReferral.referredTo || "Provider not captured"} | ${cleanReferral.reason || "Referral follow-up"}`, cleanReferral.followUpDate, true),
    ], "Referral saved and follow-up reminder added to the calendar.")
  }

  async function downloadReferralPdf(index: number) {
    try {
      if (!row.backendIntakeId) throw new Error("This case is missing a backend intake reference.")
      const saved = await saveExecutionDraft("")
      if (!saved) throw new Error("The referral could not be saved before generating its PDF.")
      const blob = await apiBlob(`/intakes/${row.backendIntakeId}/referrals/${index}/pdf/`)
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `referral-${row.id}-${index + 1}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setMessage("Referral PDF downloaded.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not generate referral PDF.")
    }
  }

  async function removeReferral(index: number) {
    const nextReferrals = referrals.filter((_, itemIndex) => itemIndex !== index)
    const saved = await saveExecutionDraft("", false, { referrals: nextReferrals })
    if (!saved) return
    setReferrals(nextReferrals)
    setMessage("Referral deleted.")
  }

  function setReferralDraftValue(key: keyof typeof referralDraft, value: string) {
    setReferralDraft((current) => ({ ...current, [key]: value }))
  }

  function setPlaceOfSafetyReferralAgency(value: string) {
    const selectedPlace = districtPlacesOfSafety.find((place) => place.partner_name === value)
    setReferralDraft((current) => ({
      ...current,
      referralAgency: value,
      referredTo: value,
      contactPerson: selectedPlace?.contact_person || current.contactPerson,
      address: selectedPlace?.address || current.address,
      telephone: selectedPlace?.phone || current.telephone,
    }))
  }

  function updateServiceProgress(index: number) {
    const careItem = careRows[index]
    setServiceDraft(serviceRows[index] ? normalizeServiceTrackingRow(serviceRows[index], careItem) : normalizeServiceTrackingRow({ implementationDate: new Date().toISOString().slice(0, 10) }, careItem))
    setServiceModalIndex(index)
    setServiceModalOpen(true)
  }

  async function saveServiceProgress() {
    const careItem = serviceModalIndex === null ? undefined : careRows[serviceModalIndex]
    if (careItem && carePlanRequiresReferral(careItem) && ["Referred", "In Progress", "Completed"].includes(serviceDraft.status) && !validReferralForCarePlanItem(careItem)) {
      setMessage(`Create and send the required referral for ${carePlanActivityLabel(careItem)} before updating implementation progress.`)
      setServiceModalOpen(false)
      setActiveTab("referrals")
      return
    }
    if (!serviceModalProvider && !serviceDraft.deliveredBy.trim() && !["Planned", "Cancelled"].includes(serviceDraft.status)) {
      setMessage("Specify who is delivering this activity, or create a referral to the service provider first.")
      return
    }
    const nextRows = careRows.map((item, index) => index === serviceModalIndex ? serviceDraft : serviceRows[index] ? normalizeServiceTrackingRow(serviceRows[index], item) : normalizeServiceTrackingRow({}, item))
    const saved = await saveExecutionDraft("", false, { serviceRows: nextRows })
    if (!saved) return
    setServiceRows(nextRows)
    setServiceModalOpen(false)
    setServiceModalIndex(null)
    setMessage(nextRows.length && nextRows.every((item) => ["Completed", "Cancelled"].includes(item.status)) ? "All implementation activities are complete." : "Implementation update saved.")
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

  function openAttachmentPreview(document: Pick<CaseDocumentRow, "previewUrl" | "fileName">) {
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
    if (!hasMeaningfulCaseNote(caseNoteDraft)) {
      setMessage("Enter the case note before saving.")
      return
    }
    const cleanedNote = { caseNote: caseNoteDraft.caseNote.trim() }
    setCaseNotes((items) => caseNoteModalIndex === null ? [...items, cleanedNote] : items.map((item, index) => index === caseNoteModalIndex ? cleanedNote : item))
    setCaseNoteModalOpen(false)
    setCaseNoteModalIndex(null)
    setMessage(caseNoteModalIndex === null ? "Case note added." : "Case note updated.")
  }

  function removeCaseNote(index: number) {
    setCaseNotes((items) => items.filter((_, itemIndex) => itemIndex !== index))
    setMessage("Case note removed.")
  }

  function requestDelete(title: string, detail: string, onConfirm: () => void) {
    setDeleteConfirmation({ title, detail, onConfirm })
  }

  function confirmDelete() {
    if (!deleteConfirmation) return
    deleteConfirmation.onConfirm()
    setDeleteConfirmation(null)
  }

  function setCaseNoteDraftValue(key: keyof CaseNoteRow, value: string) {
    setCaseNoteDraft((current) => ({ ...current, [key]: value }))
  }

  function saveClosureDraft() {
    setClosureStatus("Closure Draft")
    setMessage("Closure draft saved.")
  }

  const closureReasons = ["All objectives met", "Child died", "Child moved away", "No longer wants services", "Withdrawn from Court Ordered Supervision", "Other"]

  function setClosureDraftValue(key: keyof ClosureRecord, value: string) {
    setClosureDraft((current) => ({ ...current, [key]: value }))
  }

  function toggleClosureProcessCompleted(key: keyof ClosureProcessCompleted) {
    setClosureDraft((current) => ({ ...current, processCompleted: { ...current.processCompleted, [key]: !current.processCompleted[key] } }))
  }

  function toggleClosureReason(reason: string) {
    setClosureDraft((current) => ({ ...current, reasons: current.reasons.includes(reason) ? current.reasons.filter((item) => item !== reason) : [...current.reasons, reason] }))
  }

  function closureReadinessItems() {
    const hasCarePlan = meaningfulCareRows.length > 0
    const hasMonitoringRecord = monitoringRecords.length > 0 && Boolean(latestMonitoringRecord)
    const courtOrders = justice.courtOrders || []
    const noActiveCourtOrder = !courtOrders.some((order) => order.status === "Active")
    return [
      ["Assessment Completed", assessmentStatus === "Completed" || Boolean(row.assessmentCompletedAt), "System"],
      ["Care Plan Exists", hasCarePlan, "System"],
      ["All Care Plan Activities Completed", hasCarePlan && meaningfulImplementationTasks.length > 0 && activeInterventions.length === 0, "System"],
      ["No Pending Referrals", outstandingReferralItems.length === 0, "System"],
      ["Latest Monitoring Recorded", hasMonitoringRecord, "System"],
      ["No Active Court Order", noActiveCourtOrder, "System"],
      ["Case Notes Available", caseNotes.some(hasMeaningfulCaseNote), "System"],
    ] as Array<[string, boolean, string]>
  }

  function closureBlockingReasons() {
    const items = closureReadinessItems()
    return items.filter(([, met]) => !met).map(([label]) => label)
  }

  function submitClosure() {
    if (!closureDraft.reasons.length) {
      setMessage("Select at least one reason for closure.")
      return
    }
    if (closureDraft.reasons.includes("Other") && !closureDraft.otherReason.trim()) {
      setMessage("Explain the other reason for closure.")
      return
    }
    if (!closureDraft.currentSituation.trim()) {
      setMessage("Provide a closure summary before recommending closure.")
      return
    }
    const completedProcess = closureDraft.processCompleted
    if (!Object.values(completedProcess).some(Boolean)) {
      setMessage("Select the applicable Process Completed items before submitting closure.")
      return
    }
    if (closureDraft.reasons.includes("All objectives met") && !completedProcess.carePlanGoalsMet) {
      setMessage("Confirm that the care plan goals have been met before selecting All objectives met.")
      return
    }
    if (activeInterventions.length) {
      setMessage("Closure blocked: complete or fail all active implementation tasks before submitting closure.")
      setActiveTab("interventions")
      return
    }
    if (overdueReferrals.length) {
      setMessage("Closure blocked: resolve overdue referrals before submitting closure.")
      setActiveTab("referrals")
      return
    }
    const blockers = closureBlockingReasons()
    if (blockers.length) {
      setMessage(`Closure cannot proceed until outstanding issues are resolved: ${blockers.join(", ")}.`)
      return
    }
    void requestClosure()
  }

  async function requestClosure() {
    try {
      if (!row.backendIntakeId) throw new Error("This case is missing a backend intake reference.")
      const closureRecord = { ...closureDraft, status: "Pending Closure Approval", decision: "Pending Supervisor Approval", recommendedAt: new Date().toISOString(), recommendedBy: row.allocatedOfficer || "Allocated officer" }
      const nextHistory = closureHistory.some((item) => item.id === closureRecord.id) ? closureHistory.map((item) => item.id === closureRecord.id ? closureRecord : item) : [...closureHistory, closureRecord]
      setClosureDraft(closureRecord)
      setClosureHistory(nextHistory)
      const updated = await apiPost<IntakeRecord>(`/intakes/${row.backendIntakeId}/request-closure/`, {
        notes: closureRecord.currentSituation || closureRecord.sustainabilityAssessment,
        closure: closureRecord,
        closure_history: nextHistory,
      })
      setClosureStatus(updated.closure_status || "Requested")
      setCaseStatus("Closure Recommended")
      setClosureModalOpen(false)
      setMessage("Closure request submitted for strict supervisor approval.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not request closure.")
    }
  }

  function toggleAssessmentSection(key: string) {
    setOpenAssessmentSections((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
  }

  function renderNarrativeAccordions(definitions: AssessmentNarrativeDefinition[], includeMilestones = false) {
    return <div className="space-y-3">{definitions.map((definition) => {
      const open = openAssessmentSections.includes(definition.key)
      const complete = definition.key === "milestonesAssessmentNotes" ? milestonesComplete : narrativeComplete(definition.key)
      return <section key={definition.key} className="overflow-hidden rounded-md border border-[#d8dee8] bg-white">
        <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left" onClick={() => toggleAssessmentSection(definition.key)}>
          <span><span className="block font-bold text-[#263747]">{definition.title}</span></span>
          <span className="flex shrink-0 items-center gap-2">{complete && <span className="rounded-full bg-[#e7f6f3] px-2.5 py-1 text-xs font-bold text-[#007464]">Recorded</span>}<ChevronDown className={`h-5 w-5 transition ${open ? "rotate-180" : ""}`} /></span>
        </button>
        {open && <div className="border-t border-[#edf0f4] bg-[#fbfdff] p-4">
            {includeMilestones && definition.key === "milestonesAssessmentNotes" && <>
              <div className="mb-4"><div className="mb-2 text-sm font-bold text-[#263747]">Milestones Observed or Achieved</div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{["Sitting", "Crawling", "Walking", "Talking", "Toilet training", "Other"].map((item) => <label key={item} className={`flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${assessment.milestones.includes(item) ? "border-[#008c7a] bg-[#e7f6f3] text-[#007464]" : "border-[#d8dee8] bg-white text-[#263747]"}`}><input type="checkbox" className="h-4 w-4 accent-[#008c7a]" checked={assessment.milestones.includes(item)} onChange={() => toggleAssessmentArray("milestones", item)} />{item}</label>)}</div></div>
            {assessment.milestones.includes("Other") && <div className="mb-4"><Field label="Other milestone"><input className={inputClass} value={assessment.otherMilestone} onChange={(event) => setAssessmentValue("otherMilestone", event.target.value)} /></Field></div>}
          </>}
          <textarea aria-label={definition.key === "milestonesAssessmentNotes" ? "Milestones Assessment Notes" : definition.title} className={`${inputClass} min-h-[140px] py-3`} value={assessment[definition.key]} onChange={(event) => setAssessmentValue(definition.key, event.target.value)} />
        </div>}
      </section>
    })}</div>
  }

  function renderApprovedAssessmentStep() {
    if (assessmentStep === 0) return <SectionCard title="Assessment Details"><FormGrid>
      <div data-assessment-field="assessmentDate"><Field label="Assessment Date" required><input className={`${inputClass} ${assessmentFieldErrors.assessmentDate ? "border-[#dc2626] ring-2 ring-[#fecaca]" : ""}`} type="date" value={assessment.assessmentDate} onChange={(event) => setAssessmentValue("assessmentDate", event.target.value)} /></Field><InlineFieldError message={assessmentFieldErrors.assessmentDate} /></div>
      <div data-assessment-field="assessmentType"><Field label="Assessment Type" required><select className={`${inputClass} ${assessmentFieldErrors.assessmentType ? "border-[#dc2626] ring-2 ring-[#fecaca]" : ""}`} value={assessment.assessmentType} onChange={(event) => setAssessmentValue("assessmentType", event.target.value)}><option value="">Select</option>{["Home Visit", "Institution Visit", "Office Interview", "Phone Assessment", "School Visit"].map((item) => <option key={item}>{item}</option>)}</select></Field><InlineFieldError message={assessmentFieldErrors.assessmentType} /></div>
      <div data-assessment-field="assessmentLocation"><Field label="Assessment Location" required><input className={`${inputClass} ${assessmentFieldErrors.assessmentLocation ? "border-[#dc2626] ring-2 ring-[#fecaca]" : ""}`} value={assessment.assessmentLocation} onChange={(event) => setAssessmentValue("assessmentLocation", event.target.value)} /></Field><InlineFieldError message={assessmentFieldErrors.assessmentLocation} /></div>
      <div data-assessment-field="childSeen"><Field label="Child Seen?" required><select className={`${inputClass} ${assessmentFieldErrors.childSeen ? "border-[#dc2626] ring-2 ring-[#fecaca]" : ""}`} value={assessment.childSeen} onChange={(event) => setAssessmentValue("childSeen", event.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field><InlineFieldError message={assessmentFieldErrors.childSeen} /></div>
      <div data-assessment-field="parentCarerSeen"><Field label="Parent/Carer Seen?" required><select className={`${inputClass} ${assessmentFieldErrors.parentCarerSeen ? "border-[#dc2626] ring-2 ring-[#fecaca]" : ""}`} value={assessment.parentCarerSeen} onChange={(event) => setAssessmentValue("parentCarerSeen", event.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field><InlineFieldError message={assessmentFieldErrors.parentCarerSeen} /></div>
      <div data-assessment-field="personsInterviewed" className="md:col-span-2"><div className="mb-2 text-sm font-bold text-[#263747]">Persons Interviewed<span className="ml-1 text-[#e11d48]">*</span></div><div className={`grid gap-2 rounded-md ${assessmentFieldErrors.personsInterviewed ? "ring-2 ring-[#fecaca]" : ""} md:grid-cols-3`}>{["Child", "Mother", "Father", "Guardian", "Other caregiver", "Teacher", "Relative", "Community member", "Other"].map((item) => { const disabled = item === "Child" ? assessment.childSeen === "No" : ["Mother", "Father", "Guardian", "Other caregiver"].includes(item) && assessment.parentCarerSeen === "No"; return <label key={item} className={`flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${disabled ? "cursor-not-allowed bg-[#eef2f5] text-[#94a3b8]" : assessment.personsInterviewed.includes(item) ? "border-[#008c7a] bg-[#e7f6f3] text-[#007464]" : assessmentFieldErrors.personsInterviewed ? "border-[#dc2626] bg-white text-[#263747]" : "border-[#d8dee8] bg-white text-[#263747]"}`}><input type="checkbox" disabled={disabled} className="h-4 w-4 accent-[#008c7a]" checked={assessment.personsInterviewed.includes(item)} onChange={() => toggleAssessmentArray("personsInterviewed", item)} />{item}</label> })}</div><InlineFieldError message={assessmentFieldErrors.personsInterviewed} /></div>
      {assessment.personsInterviewed.includes("Other") && <div data-assessment-field="otherPersonInterviewed"><Field label="Other Person Interviewed" required><input className={`${inputClass} ${assessmentFieldErrors.otherPersonInterviewed ? "border-[#dc2626] ring-2 ring-[#fecaca]" : ""}`} value={assessment.otherPersonInterviewed} onChange={(event) => setAssessmentValue("otherPersonInterviewed", event.target.value)} /></Field><InlineFieldError message={assessmentFieldErrors.otherPersonInterviewed} /></div>}
      <div className="md:col-span-2 overflow-hidden rounded-md border border-[#d8dee8] bg-white">
        <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left" onClick={() => toggleAssessmentSection("assessmentVisitNotes")}>
          <span className="font-bold text-[#263747]">Assessment Visit Notes</span>
          <span className="flex shrink-0 items-center gap-2">{assessment.assessmentVisitNotes.trim() && <span className="rounded-full bg-[#e7f6f3] px-2.5 py-1 text-xs font-bold text-[#007464]">Recorded</span>}<ChevronDown className={`h-5 w-5 transition ${openAssessmentSections.includes("assessmentVisitNotes") ? "rotate-180" : ""}`} /></span>
        </button>
        {openAssessmentSections.includes("assessmentVisitNotes") && <div className="border-t border-[#edf0f4] bg-[#fbfdff] p-4"><textarea aria-label="Assessment Visit Notes" className={`${inputClass} min-h-[140px] py-3`} value={assessment.assessmentVisitNotes} onChange={(event) => setAssessmentValue("assessmentVisitNotes", event.target.value)} /></div>}
      </div>
      <div className="md:col-span-2 overflow-hidden rounded-md border border-[#d8dee8] bg-white">
        <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left" onClick={() => toggleAssessmentSection("childOwnStory")}>
          <span className="font-bold text-[#263747]">The Child’s Own Story (Circumstances, ambitions and aspirations)</span>
          <span className="flex shrink-0 items-center gap-2">{assessment.childOwnStory.trim() && <span className="rounded-full bg-[#e7f6f3] px-2.5 py-1 text-xs font-bold text-[#007464]">Recorded</span>}<ChevronDown className={`h-5 w-5 transition ${openAssessmentSections.includes("childOwnStory") ? "rotate-180" : ""}`} /></span>
        </button>
        {openAssessmentSections.includes("childOwnStory") && <div className="border-t border-[#edf0f4] bg-[#fbfdff] p-4"><textarea aria-label="The Child’s Own Story (Circumstances, ambitions and aspirations)" className={`${inputClass} min-h-[140px] py-3`} value={assessment.childOwnStory} onChange={(event) => setAssessmentValue("childOwnStory", event.target.value)} /></div>}
      </div>
    </FormGrid></SectionCard>
    if (assessmentStep === 1) return <SectionCard title="The Child's Developmental Needs">{renderNarrativeAccordions(childDevelopmentAssessmentSections, true)}</SectionCard>
    if (assessmentStep === 2) return <SectionCard title="Parent/Carers Capacity to Respond Appropriately to the Child's Needs">{renderNarrativeAccordions(parentCarerAssessmentSections)}</SectionCard>
    if (assessmentStep === 3) return <SectionCard title="Environmental Factors Which Impact on Children and the Family">{renderNarrativeAccordions(environmentalAssessmentSections)}</SectionCard>
    return <div className="space-y-4"><SectionCard title="Review Assessment">
      <div className="space-y-5"><section className="rounded-md border border-[#d8dee8] p-4"><div className="mb-3 flex items-center justify-between"><h4 className="font-bold text-[#263747]">Assessment Details</h4><button className="text-sm font-bold text-[#008c7a]" onClick={() => setAssessmentStep(0)}>Edit Section</button></div><SummaryFieldGrid items={[["Assessment Date", assessment.assessmentDate], ["Assessment Type", assessment.assessmentType], ["Assessment Location", assessment.assessmentLocation], ["Child Seen", assessment.childSeen], ["Parent/Carer Seen", assessment.parentCarerSeen], ["Persons Interviewed", assessment.personsInterviewed], ["Other Person Interviewed", assessment.otherPersonInterviewed], ["Assessment Visit Notes", assessment.assessmentVisitNotes], ["The Child’s Own Story (Circumstances, ambitions and aspirations)", assessment.childOwnStory]]} /></section>
      {([["The Child's Developmental Needs", childDevelopmentAssessmentSections, 1], ["Parent/Carers Capacity to Respond Appropriately to the Child's Needs", parentCarerAssessmentSections, 2], ["Environmental Factors Which Impact on Children and the Family", environmentalAssessmentSections, 3]] as const).map(([title, definitions, step]) => <section key={title} className="rounded-md border border-[#d8dee8] p-4"><div className="mb-3 flex items-center justify-between gap-3"><h4 className="font-bold text-[#263747]">{title}</h4><button className="shrink-0 text-sm font-bold text-[#008c7a]" onClick={() => setAssessmentStep(step)}>Edit Section</button></div><SummaryFieldGrid layout="stack" items={definitions.map(({ key, title: fieldTitle }) => [fieldTitle, assessment[key] || "Not recorded"])} /></section>)}</div>
    </SectionCard></div>
  }

  if (changeRequestsOpen) {
    return (
      <div className="space-y-4">
        <Panel
          title="Change Requests"
          icon={History}
          action={<span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-semibold text-[#475569]">{row.id}</span>}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#d8dee8] pb-4">
            <div>
              <h2 className="text-xl font-extrabold text-[#263747]">Case Change Requests</h2>
              <p className="mt-1 text-sm font-semibold text-[#64748b]">{row.id} | {row.childName}</p>
            </div>
            <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 text-sm font-semibold text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]" onClick={() => { setChangeRequestsOpen(false); setSelectedChangeRequestId(null) }}>Back to case workspace</button>
          </div>

          <section className="grid gap-3 md:grid-cols-4">
            <MiniCard title="Total Requests" value={`${changeRequests.length}`} icon={History} />
            <MiniCard title="Approved" value={`${changeRequests.filter((request) => request.status === "Approved").length}`} icon={CheckCircle2} />
            <MiniCard title="Pending" value={`${changeRequests.filter((request) => request.status === "Pending").length}`} icon={Clock3} />
            <MiniCard title="Rejected" value={`${changeRequests.filter((request) => request.status === "Rejected").length}`} icon={X} />
          </section>

          <section className="mt-4 overflow-hidden rounded-md border border-[#d8dee8] bg-white">
            <div className="border-b border-[#d8dee8] bg-[#f8fafc] px-4 py-3">
              <h3 className="text-base font-extrabold text-[#263747]">Requests Table</h3>
              <p className="mt-1 text-sm font-semibold text-[#64748b]">Click a request number to view full old-value, new-value and supervisor review details.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] border-collapse text-left text-sm">
                <thead className="bg-white text-[#2e6fa3]">
                  <tr>{["Request #", "Date", "Section", "Reason", "Fields", "Status"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-4 py-3">{head}</th>)}</tr>
                </thead>
                <tbody>
                  {changeRequests.length ? changeRequests.map((request) => (
                    <tr key={request.id} className="bg-white hover:bg-[#f8fafc]">
                      <td className="border-b border-[#edf0f4] px-4 py-3">
                        <button className="font-extrabold text-[#1f5f99] underline-offset-2 hover:text-[#008c7a] hover:underline" onClick={() => openChangeRequestDetails(request)}>
                          {changeRequestNumber(request)}
                        </button>
                      </td>
                      <td className="border-b border-[#edf0f4] px-4 py-3 text-[#50617a]">{formatWorkflowDateTime(request.requested_at)}</td>
                      <td className="border-b border-[#edf0f4] px-4 py-3 font-semibold text-[#263747]">{request.tab}</td>
                      <td className="max-w-[360px] border-b border-[#edf0f4] px-4 py-3 text-[#50617a]">{request.reason}</td>
                      <td className="border-b border-[#edf0f4] px-4 py-3 font-bold text-[#263747]">{changeRequestFields(request).length}</td>
                      <td className="border-b border-[#edf0f4] px-4 py-3"><StatusBadge status={request.status} /></td>
                    </tr>
                  )) : <tr><td className="px-4 py-10 text-center text-[#64748b]" colSpan={6}>No change requests recorded for this case.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </Panel>

        {selectedChangeRequest && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
            <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-md border border-[#d8dee8] bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-[#d8dee8] bg-[#f8fafc] px-5 py-4">
                <div>
                  <div className="text-xs font-bold uppercase text-[#64748b]">Request Details</div>
                  <h3 className="mt-1 text-xl font-extrabold text-[#263747]">{changeRequestNumber(selectedChangeRequest)}</h3>
                  <p className="mt-1 text-sm font-semibold text-[#64748b]">{row.id} | {selectedChangeRequest.tab}</p>
                </div>
                <button className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]" onClick={() => setSelectedChangeRequestId(null)} aria-label="Close request details">x</button>
              </div>
              <div className="max-h-[calc(92vh-92px)] overflow-y-auto p-5">
                <div className="grid gap-3 md:grid-cols-4">
                  <Info label="Request Number" value={changeRequestNumber(selectedChangeRequest)} />
                  <Info label="Submitted" value={formatWorkflowDateTime(selectedChangeRequest.requested_at)} />
                  <Info label="Section" value={selectedChangeRequest.tab} />
                  <Info label="Status" value={selectedChangeRequest.status} />
                </div>
                <section className="mt-4 overflow-hidden rounded-md border border-[#d8dee8] bg-white">
                  <div className="border-b border-[#d8dee8] bg-[#f8fafc] px-4 py-3 text-sm font-extrabold text-[#263747]">Fields Changed</div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                      <thead className="text-[#2e6fa3]"><tr>{["Field", "Previous Value", "Requested Value"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-4 py-3">{head}</th>)}</tr></thead>
                      <tbody>{changeRequestFields(selectedChangeRequest).map((field) => <tr key={field.label}><td className="border-b border-[#edf0f4] px-4 py-3 font-bold">{field.label}</td><td className="border-b border-[#edf0f4] px-4 py-3">{field.oldValue}</td><td className="border-b border-[#edf0f4] px-4 py-3 font-bold text-[#007464]">{field.newValue}</td></tr>)}</tbody>
                    </table>
                  </div>
                </section>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Info label="Reason for change" value={selectedChangeRequest.reason} />
                  <section className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-3">
                    <div className="text-xs font-bold uppercase text-[#64748b]">Supervisor Review</div>
                    <div className="mt-2 grid gap-2 text-sm font-semibold text-[#263747]">
                      <div>Reviewed By: {selectedChangeRequest.reviewedByName || "Pending review"}</div>
                      <div>Decision: {selectedChangeRequest.status}</div>
                      <div>Review Date: {selectedChangeRequest.reviewed_at ? formatWorkflowDateTime(selectedChangeRequest.reviewed_at) : "Pending"}</div>
                      <div>Comment: {selectedChangeRequest.review_notes || "No comment captured"}</div>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (caseTimelineOpen) {
    const timelineEvents = caseTimelineEvents()
    const timelineCategories = ["Workflow", "Change Requests", "Referrals", "Monitoring", "Closure"]
      .map((category) => ({ category, count: timelineEvents.filter((event) => event.category === category).length }))
      .filter((item) => item.count)

    return (
      <div className="space-y-4">
        <Panel
          title="Case Timeline"
          icon={History}
          action={<span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-semibold text-[#475569]">{row.id}</span>}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#d8dee8] pb-4">
            <div>
              <h2 className="text-xl font-extrabold text-[#263747]">Complete Case Timeline</h2>
              <p className="mt-1 text-sm font-semibold text-[#64748b]">{row.id} | {row.childName} | system-generated case history</p>
            </div>
            <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 text-sm font-semibold text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]" onClick={() => setCaseTimelineOpen(false)}>Back to case workspace</button>
          </div>

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MiniCard title="Total Events" value={`${timelineEvents.length}`} icon={History} />
            {timelineCategories.map((item) => (
              <div key={item.category} className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
                <div className="text-xs font-bold uppercase text-[#64748b]">{item.category}</div>
                <div className="mt-2 text-2xl font-extrabold text-[#263747]">{item.count}</div>
              </div>
            ))}
          </section>

          <section className="mt-4 rounded-md border border-[#d8dee8] bg-white">
            <div className="border-b border-[#d8dee8] bg-[#f8fafc] px-4 py-3">
              <h3 className="text-base font-extrabold text-[#263747]">Case Story</h3>
              <p className="mt-1 text-sm font-semibold text-[#64748b]">Events are recorded automatically from workflow activity, referrals, monitoring, reviews, change requests and closure actions.</p>
            </div>
            <div className="p-4">
              {timelineEvents.length ? (
                <div className="relative space-y-4 before:absolute before:left-[13px] before:top-2 before:h-[calc(100%-16px)] before:w-0.5 before:bg-[#d8dee8]">
                  {timelineEvents.map((event, index) => (
                    <div key={`${event.category}-${event.date}-${index}`} className="relative grid gap-3 pl-10 md:grid-cols-[180px_1fr]">
                      <span className="absolute left-0 top-3 h-7 w-7 rounded-full border-4 border-white bg-[#008c7a] shadow" />
                      <div className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-3">
                        <div className="text-xs font-extrabold uppercase text-[#64748b]">{event.category}</div>
                        <div className="mt-1 text-sm font-extrabold text-[#263747]">{formatWorkflowDateTime(event.date)}</div>
                      </div>
                      <div className="rounded-md border border-[#d8dee8] bg-white p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-extrabold text-[#263747]">{event.title}</h4>
                          {event.status && <StatusBadge status={event.status} />}
                        </div>
                        <p className="mt-1 text-sm font-semibold leading-6 text-[#64748b]">{event.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-[#d8dee8] bg-[#f8fafc] px-4 py-10 text-center font-semibold text-[#64748b]">No timeline events are available yet.</div>
              )}
            </div>
          </section>
        </Panel>
      </div>
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
          <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 text-sm font-semibold text-[#263747]" onClick={onBack}>{backLabel}</button>
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <>
                <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={openChangeRequests}>Change Requests</button>
                <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setCaseTimelineOpen(true)}>Case Timeline</button>
                <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]">Print Case Summary</button>
              </>
            )}
            {onOpenFullIntake && <button className="rounded-md bg-[#008c7a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#007767]" onClick={onOpenFullIntake}>Open Full Intake</button>}
          </div>
        </div>
        {!canManage && (
          <div className="mb-4 rounded-md border border-[#d8dee8] bg-[#f8fafc] p-3 text-sm font-semibold text-[#475569]">
            {approvalPending ? "Supervisor approval view. Review the submitted assessment and care plan in the original case layout below." : "Supervisor view only. The allocated officer is responsible for case actions."}
          </div>
        )}
        {canManage && revisionRequested && (
          <div className="mb-4 rounded-md border border-[#f4c66b] bg-[#fffaf0] p-3 text-sm font-semibold text-[#8a5a12]">
            <div>{carePlanStatus}. Make the required corrections and resubmit the assessment and care plan.</div>
            <div className="mt-2 rounded-md bg-white/70 px-3 py-2 text-[#50617a]">DSDO comments: {textValue(row.intakeDraft?.assessment_care_plan_review_notes) || "No comments recorded."}</div>
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
              <span className="rounded-full bg-[#e7f6f3] px-3 py-1 text-xs font-bold text-[#007464]">{row.assessmentCompletedAt ? "Assessment Completed" : caseStatus}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Info label="Case Number" value={row.id} />
              <Info label="Child" value={row.childName} />
              <Info label="Age / Sex" value={`${row.age} / ${row.sex}`} />
              <Info label="District / Ward" value={`${row.district} / ${row.ward}`} />
              <Info label="Assigned Officer" value={row.allocatedOfficer || "Not assigned"} />
              <Info label="Date Allocated" value={row.allocatedAt || textValue(row.intakeDraft?.allocated_at) ? formatWorkflowDateTime(row.allocatedAt || textValue(row.intakeDraft?.allocated_at)) : "Not recorded"} />
              <Info label="Case Category" value={row.concern} />
              <Info label={row.assessmentCompletedAt ? "Assessment Completed" : "Assessment Due"} value={row.assessmentCompletedAt ? formatWorkflowDateTime(row.assessmentCompletedAt) : lifecycleDeadlines.assessment.dueLabel} />
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
        {message && <div className="mt-4 rounded-md border border-[#b7e4d8] bg-[#f0fdf9] p-3 text-sm font-semibold text-[#007464]">{message}</div>}
      </Panel>

      <Panel title="Case Lifecycle" icon={FolderCheck}>
        <div className="mb-5 grid grid-cols-2 border-b border-[#d8dee8] sm:grid-cols-5 lg:grid-cols-10">
          {phaseTabs.map(([key, label]) => (
            <button key={key} className={`relative min-h-12 min-w-0 px-1 text-center text-[10px] font-bold uppercase tracking-tight sm:text-xs ${activeTab === key ? "text-[#008c7a]" : "text-[#50617a] hover:text-[#008c7a]"}`} onClick={() => setActiveTab(key)}>
              {label}
              {activeTab === key && <span className="absolute bottom-[-1px] left-0 h-1 w-full rounded-t bg-[#008c7a]" />}
            </button>
          ))}
        </div>

        {canManage && !packageApproved && !["details", "assessment", "care"].includes(activeTab) && (
          <div className="mb-5 rounded-md border border-[#f4c66b] bg-[#fffaf0] px-4 py-3 text-sm font-semibold text-[#8a5a12]">
            {approvalPending
              ? "Assessment & Care Plan submitted. Waiting for DSDO approval before work can begin in this section."
              : "Submit the Assessment & Care Plan and receive DSDO approval before starting work in this section."}
          </div>
        )}

        {!canManage && activeTab === "assessment" && (
          <section className="mb-5 rounded-md border border-[#d8dee8] bg-white p-4">
            <div className="mb-3 text-sm font-semibold text-[#64748b]">Select any assessment section to review its recorded information.</div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
              {assessmentStages.map((stage, index) => (
                <button key={stage.label} type="button" className={`rounded-md border px-3 py-3 text-left text-sm font-bold transition ${assessmentStep === index ? "border-[#2e6fa3] bg-[#eef8ff] text-[#1f4f7a]" : stage.complete ? "border-[#008c7a] bg-[#e7f6f3] text-[#007464] hover:border-[#007464]" : "border-[#d8dee8] bg-white text-[#50617a] hover:border-[#2e6fa3]"}`} onClick={() => goToAssessmentStep(index)}>
                  {stage.complete ? "✓" : "○"} {index + 1}. {stage.label}
                </button>
              ))}
            </div>
          </section>
        )}

        <fieldset disabled={activeSectionLocked} className={`min-w-0 ${activeSectionLocked ? "opacity-90" : ""}`}>
        {activeTab === "details" && <AllocatedCaseDetails row={row} />}

        {activeTab === "assessment" && (
          <div className="space-y-5">
            {canManage && <section className="rounded-md border border-[#d8dee8] bg-white p-4">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                {assessmentStages.map((stage, index) => (
                  <button key={stage.label} type="button" className={`rounded-md border px-3 py-3 text-left text-sm font-bold ${assessmentStep === index ? "border-[#2e6fa3] bg-[#eef8ff] text-[#1f4f7a]" : stage.required.length ? "border-[#f4b4ac] bg-[#fff7f5] text-[#b42318]" : stage.complete ? "border-[#008c7a] bg-[#e7f6f3] text-[#007464]" : "border-[#d8dee8] bg-white text-[#50617a]"}`} onClick={() => selectAssessmentStep(index)}>
                    {stage.required.length ? "⚠" : stage.complete ? "✓" : assessmentStep === index ? "●" : "○"} {index + 1}. {stage.label}
                  </button>
                ))}
              </div>
            </section>}
            {renderApprovedAssessmentStep()}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#d8dee8] bg-white p-3">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={saveAssessment}>Save Draft</button>
              <div className="flex flex-wrap gap-2">
                <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747] disabled:opacity-50" disabled={assessmentStep === 0} onClick={() => goToAssessmentStep(assessmentStep - 1)}>Previous</button>
                {assessmentStep < assessmentStages.length - 1 ? <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={() => goToAssessmentStep(assessmentStep + 1)}>Next</button> : <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={() => void completeAssessmentAndContinue()}>Next</button>}
              </div>
            </div>
          </div>
        )}

        {activeTab === "care" && (
          <div className="min-w-0 space-y-5 overflow-hidden">
            {!assessmentIsCompleted && <section className="rounded-md border border-[#f4c66b] bg-[#fffaf0] p-5"><h3 className="text-lg font-extrabold text-[#8a5a12]">Assessment Must Be Completed First</h3><p className="mt-2 text-sm font-semibold leading-6 text-[#50617a]">The care plan must be based on the completed assessment findings, conclusions and recommendations. Complete the assessment before developing the care plan.</p><div className="mt-4 flex flex-wrap gap-2"><button className="rounded-md bg-[#008c7a] px-4 py-2 text-sm font-semibold text-white" onClick={() => setActiveTab("assessment")}>Go to Assessment</button><button className="rounded-md border border-[#008c7a] bg-white px-4 py-2 text-sm font-semibold text-[#007464]" onClick={() => { setActiveTab("assessment"); setAssessmentStep(4) }}>View Assessment Progress</button></div></section>}
            <fieldset disabled={!assessmentIsCompleted} className={!assessmentIsCompleted ? "opacity-55" : ""}>
            <div className="grid min-w-0 gap-4 md:grid-cols-4">
              <MiniCard title="Care Plan Status" value={carePlanStatus} icon={FolderCheck} />
              <MiniCard title="Care Plan Activities" value={`${careRows.length}`} icon={CheckSquare} />
              <MiniCard title="Case Conferences" value={`${caseConferences.length}`} icon={Users} />
              <MiniCard title="Assessment Status" value={assessmentStatus} icon={FileSearch} />
            </div>
            <SectionCard title="Care Plan">
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <h4 className="font-bold text-[#263747]">Case Conference</h4>
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="text-sm font-semibold text-[#263747]">Was a case conference held?</span>
                    {(["Yes", "No"] as const).map((value) => <label key={value} className="flex items-center gap-2 text-sm font-semibold text-[#263747]"><input type="radio" name="case-conference-held" className="h-4 w-4 accent-[#008c7a]" checked={caseConferenceHeld === value} onChange={() => setCaseConferenceHeld(value)} />{value}</label>)}
                  </div>
                  {caseConferenceHeld === "No" && <span className="text-sm font-semibold text-[#64748b]">No case conference was held for this case.</span>}
                  {caseConferenceHeld === "Yes" && <button className="ml-auto rounded-md bg-[#008c7a] px-4 py-2 text-sm font-semibold text-white" onClick={addCaseConference}>+ Record Case Conference</button>}
                </div>
                {caseConferenceHeld === "Yes" && <div className="mt-3">
                  <div className="w-full max-w-full overflow-x-auto rounded-md border border-[#d8dee8]">
                    <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                      <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Date", "Participants", "Agreements", "Action"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
                      <tbody>{caseConferences.length ? caseConferences.map((conference, index) => <tr key={conference.id} className="bg-white"><td className="border-b border-[#edf0f4] px-3 py-3">{conference.date}</td><td className="border-b border-[#edf0f4] px-3 py-3">{conferenceEntryCount(conference.participants)}</td><td className="border-b border-[#edf0f4] px-3 py-3">{conferenceEntryCount(conference.decisions)}</td><td className="border-b border-[#edf0f4] px-3 py-3"><div className="flex items-center gap-2"><button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#2e6fa3] hover:border-[#008c7a] hover:text-[#008c7a]" title="Edit conference" onClick={() => editCaseConference(index)}><PencilLine className="h-4 w-4" /></button><button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#f4b4ac] bg-white text-[#b42318] hover:bg-[#fff7f5]" title="Remove conference" onClick={() => requestDelete("Delete case conference?", "This case conference record will be removed from the care plan.", () => removeCaseConference(index))}><Trash2 className="h-4 w-4" /></button></div></td></tr>) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={4}>No case conferences recorded yet.</td></tr>}</tbody>
                    </table>
                  </div>
                </div>}
              </section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="mt-4">
                  <h4 className="font-bold text-[#263747]">Care Plan Activities</h4>
                  <p className="mt-1 text-sm font-semibold text-[#64748b]">Add each agreed care plan activity as a trackable item.</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {carePlanLocked ? <button disabled={hasPendingCarePlanChange} className="rounded-md border border-[#008c7a] bg-white px-4 py-2 text-sm font-semibold text-[#007d6d] disabled:cursor-not-allowed disabled:border-[#cbd5e1] disabled:text-[#94a3b8]" onClick={openCarePlanChangeRequest}>{hasPendingCarePlanChange ? "Change Request Pending" : "Request Change"}</button> : <button className="rounded-md bg-[#008c7a] px-4 py-2 text-sm font-semibold text-white" onClick={addCareRow}>+ Add Care Plan Activity</button>}
                </div>
              </div>
              <div className="w-full max-w-full overflow-x-auto rounded-md border border-[#d8dee8]">
                <table className="w-full min-w-[820px] border-collapse text-left text-sm" style={{ tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "16%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "28%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "16%" }} />
                  </colgroup>
                  <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Care Plan Activity", "Responsible", "Target Date", "Action Plan Notes", "Status", "Action"].map((head) => <th key={head} className="overflow-hidden whitespace-nowrap border-b border-[#d8dee8] px-3 py-3 text-ellipsis">{head}</th>)}</tr></thead>
                  <tbody>{careRows.length ? careRows.map((item, index) => (
                    <tr key={`${item.assistanceType}-${index}`} className="bg-white">
                      <td className="overflow-hidden border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]"><div className="truncate">{item.assistanceType === "Other" && item.otherAssistanceDescription ? `Other: ${item.otherAssistanceDescription}` : item.assistanceType || "-"}</div></td>
                      <td className="overflow-hidden border-b border-[#edf0f4] px-3 py-3"><div className="truncate">{item.responsiblePerson === "Other" ? item.otherResponsiblePerson || "Other" : item.responsiblePerson || "-"}</div>{carePlanRequiresReferral(item) && (validReferralForCarePlanItem(item) ? <div className="mt-1 truncate text-xs font-bold text-[#008c7a]">Referral recorded</div> : <div className="mt-1 truncate text-xs font-bold text-[#a05b16]">Referral required</div>)}</td>
                      <td className="overflow-hidden whitespace-nowrap border-b border-[#edf0f4] px-3 py-3 text-ellipsis">{item.dueDate || item.timeline || "-"}</td>
                      <td className="overflow-hidden border-b border-[#edf0f4] px-3 py-3">
                        <div className="block w-full max-w-full overflow-hidden whitespace-nowrap text-ellipsis" title="Open this activity with the pencil to view the complete Action Plan Notes.">{item.actionPlanNotes || "-"}</div>
                      </td>
                      <td className="overflow-hidden border-b border-[#edf0f4] px-3 py-3"><StatusPill label={serviceRows[index]?.status || "Planned"} tone="review" /></td>
                      <td className="overflow-hidden border-b border-[#edf0f4] px-3 py-3">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          {!carePlanLocked && <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#2e6fa3] hover:border-[#008c7a] hover:text-[#008c7a]" title="Edit care plan item" onClick={() => editCareRow(index)}>
                            <PencilLine className="h-4 w-4" />
                          </button>}
                          {!carePlanLocked && <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[#f4b4ac] bg-white text-[#b42318] hover:bg-[#fff7f5]" title="Remove care plan item" onClick={() => requestDelete("Delete care plan activity?", "This care plan activity and its linked service-tracking row will be removed.", () => removeCareRow(index))}>
                            <Trash2 className="h-4 w-4" />
                          </button>}
                          {carePlanLocked && <span className="text-xs font-semibold text-[#64748b]">Approved</span>}
                        </div>
                      </td>
                    </tr>
                  )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={6}>No care plan activities yet. Add one activity at a time.</td></tr>}</tbody>
                </table>
              </div>
            </SectionCard>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#d8dee8] bg-white p-3">
              <button disabled={carePlanLocked} className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747] disabled:cursor-not-allowed disabled:bg-[#f1f5f9] disabled:text-[#94a3b8]" onClick={saveCarePlan}>Save Draft</button>
              <div className="flex flex-wrap gap-2">
                <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={() => { setActiveTab("assessment"); setAssessmentStep(4); window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" })) }}>Previous</button>
                <button disabled={approvalPending || carePlanLocked} className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#94a3b8] disabled:text-white" onClick={completeCarePlanAndContinue}>{hasPendingCarePlanChange ? "Change Request Awaiting DSDO" : carePlanLocked ? "Assessment & Care Plan Approved" : approvalPending ? "Submitted — Awaiting DSDO Review" : revisionRequested ? "Resubmit Assessment & Care Plan" : "Submit Assessment & Care Plan"}</button>
              </div>
            </div>
            </fieldset>
          </div>
        )}

        {activeTab === "justice" && (
          <div className="space-y-5">
            <SectionCard title="Court Orders">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[#64748b]">Supporting documents are available under Attachments.</p>
                <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={addCourtOrder}><Plus className="h-4 w-4" /> Add Court Order</button>
              </div>
              <div className="overflow-x-auto rounded-md border border-[#d8dee8]">
                <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                  <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Order Type", "Court", "Case Number", "Issued", "Status", "Action"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
                  <tbody>{justice.courtOrders.length ? justice.courtOrders.map((order, index) => (
                    <tr key={order.id} className="bg-white">
                      <td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]">{order.courtOrderType}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{order.courtName}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{order.courtCaseNumber}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{order.dateIssued}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3"><StatusPill label={order.status} tone="review" /></td>
                      <td className="border-b border-[#edf0f4] px-3 py-3"><div className="flex items-center gap-2"><button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#2e6fa3] hover:border-[#008c7a]" title="Edit court order" onClick={() => editCourtOrder(index)}><PencilLine className="h-4 w-4" /></button><button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#f4b4ac] bg-white text-[#b42318]" title="Delete court order" onClick={() => requestDelete("Delete court order?", "This court order will be removed from the Justice tab.", () => removeCourtOrder(index))}><Trash2 className="h-4 w-4" /></button></div></td>
                    </tr>
                  )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={6}>No court orders captured yet.</td></tr>}</tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        )}

        {activeTab === "referrals" && (
          <div className="space-y-5">
            <section className="min-w-0 overflow-hidden rounded-md border border-[#d8dee8] bg-white p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-[#263747]">Referrals</h3>
                <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={() => addReferral()}><Plus className="h-4 w-4" /> Create Referral</button>
              </div>
              {outstandingReferralItems.length > 0 && <div className="mb-4 rounded-md border border-[#f4d38a] bg-[#fff8e6] p-4">
                <div className="font-bold text-[#8a5a12]">Required referrals still outstanding</div>
                <div className="mt-3 space-y-2">{outstandingReferralItems.map((item, index) => <div key={`${carePlanActivityLabel(item)}-${index}`} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#f4d38a] bg-white px-3 py-2"><div><div className="font-bold text-[#263747]">{carePlanActivityLabel(item)}</div><div className="text-xs text-[#64748b]">Responsible: {item.responsiblePerson === "Other" ? item.otherResponsiblePerson || "Other" : item.responsiblePerson}</div></div><button type="button" className="grid h-10 w-10 place-items-center rounded-md bg-[#008c7a] text-white transition hover:bg-[#007464] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#008c7a]/40" onClick={() => addReferral(item)} title={`Create referral for ${carePlanActivityLabel(item)}`} aria-label={`Create referral for ${carePlanActivityLabel(item)}`}><Send className="h-4 w-4" /></button></div>)}</div>
              </div>}
              {visibleReferrals.length ? <div className="w-full max-w-full overflow-x-auto rounded-md border border-[#d8dee8]">
                <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                  <thead className="bg-[#f8fafc] text-[#2e6fa3]">
                    <tr>{["Care Plan Activity", "Referral Agency", "Referral Date", "Follow-up Date", "Feedback", "Action"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr>
                  </thead>
                  <tbody>{visibleReferrals.map(({ referral, index }) => (
                    <tr key={`${referral.type}-${referral.date}-${index}`} className="bg-white">
                      <td className="border-b border-[#edf0f4] px-3 py-3">{referral.linkedCarePlanItem || "Not linked"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]">{referral.referralAgency || referral.referredTo || "Not captured"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{referral.date || "-"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{referral.followUpDate || "-"}</td>
                      <td className="max-w-[220px] border-b border-[#edf0f4] px-3 py-3">{referral.outcome || "No feedback received"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">
                        <div className="flex items-center gap-2">
                          <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]" title="Download referral PDF" onClick={() => void downloadReferralPdf(index)}>
                            <Printer className="h-4 w-4" />
                          </button>
                          <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#2e6fa3] hover:border-[#008c7a] hover:text-[#008c7a]" title="Edit referral" onClick={() => editReferral(index)}>
                            <PencilLine className="h-4 w-4" />
                          </button>
                          <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#f4b4ac] bg-white text-[#b42318] hover:bg-[#fff7f5]" title="Delete referral" onClick={() => requestDelete("Delete referral?", "This referral record will be removed from the case.", () => removeReferral(index))}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div> : <div className="rounded-md border border-dashed border-[#d8dee8] bg-[#f8fafc] px-4 py-8 text-center font-semibold text-[#64748b]">No referral recorded.</div>}
            </section>
          </div>
        )}

        {activeTab === "interventions" && (
          <div className="space-y-5">
            <SectionCard title="Service Tracking">
              <div className="w-full max-w-full overflow-x-auto rounded-md border border-[#d8dee8]">
                <table className="w-full min-w-[900px] table-fixed text-left text-sm">
                  <colgroup>
                    <col className="w-[20%]" />
                    <col className="w-[22%]" />
                    <col className="w-[27%]" />
                    <col className="w-[11%]" />
                    <col className="w-[20%]" />
                  </colgroup>
                  <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Intervention", "Provider / Referral", "Progress", "Status", "Action"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
                  <tbody>{careRows.length ? careRows.map((item, index) => {
                    const service = serviceRows[index] ? normalizeServiceTrackingRow(serviceRows[index], item) : normalizeServiceTrackingRow({}, item)
                    const provider = providerForCarePlanItem(item)
                    const intervention = item.assistanceType || item.plannedAction || "-"
                    const progress = service.implementationNotes || "No implementation notes"
                    const referralBlocked = carePlanRequiresReferral(item) && !validReferralForCarePlanItem(item)
                    return <tr key={`${item.assistanceType}-${index}`}>
                      <td className="min-w-0 border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]"><div className="truncate" title={intervention}>{intervention}</div></td>
                      <td className="min-w-0 border-b border-[#edf0f4] px-3 py-3">{referralBlocked ? <><div className="truncate font-semibold text-[#263747]">{item.responsiblePerson === "Other" ? item.otherResponsiblePerson || "Other" : item.responsiblePerson}</div><div className="truncate text-xs font-bold text-[#b42318]">Required referral not recorded</div></> : provider ? <><div className="truncate font-semibold text-[#263747]" title={provider.agency}>{provider.agency}</div><div className="truncate text-xs font-medium text-[#64748b]">Referral recorded</div></> : service.deliveredBy ? <div className="truncate font-semibold text-[#263747]" title={service.deliveredBy}>{service.deliveredBy}</div> : <span className="block truncate text-[#64748b]">Not assigned</span>}</td>
                      <td className="min-w-0 border-b border-[#edf0f4] px-3 py-3"><div className="truncate" title={progress}>{progress}</div></td>
                      <td className="min-w-0 border-b border-[#edf0f4] px-3 py-3"><div className="truncate" title={service.status}>{service.status}</div></td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{referralBlocked ? <button className="inline-flex items-center gap-2 whitespace-nowrap rounded-md border border-[#f4d38a] bg-[#fff8e6] px-3 py-2 text-sm font-semibold text-[#8a5a12]" onClick={() => addReferral(item)} title="Create the required referral before implementation"><Send className="h-4 w-4" /> Referral Required</button> : <button className="whitespace-nowrap rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => updateServiceProgress(index)}>Update Implementation</button>}</td>
                    </tr>
                  }) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={5}>Intervention tasks will appear automatically from care plan items.</td></tr>}</tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        )}

        {activeTab === "notes" && (
          <div className="space-y-5">
            <SectionCard title="Case Notes" action={<div className="flex flex-wrap gap-2">{caseNotes.length > 0 && <button type="button" className="h-10 rounded-md border border-[#008c7a] bg-white px-4 text-sm font-semibold text-[#007464]" onClick={() => setAllCaseNotesModalOpen(true)}>View all notes ({caseNotes.length})</button>}<button type="button" className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={addCaseNote}><Plus className="h-4 w-4" /> Add Case Note</button></div>}>
              {recentCaseNotes.length ? <div className="grid gap-3 lg:grid-cols-3">
                {recentCaseNotes.map(({ note, index }) => <article key={`${index}-${note.caseNote.slice(0, 40)}`} className="flex min-w-0 flex-col rounded-md border border-[#d8dee8] bg-[#fbfdff] p-4">
                  <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[#2e6fa3]">Case note {index + 1}</div>
                  <p className="line-clamp-4 min-h-[6rem] break-words whitespace-pre-wrap text-sm leading-6 text-[#263747]">{note.caseNote}</p>
                  <div className="mt-4 flex items-center justify-between border-t border-[#edf0f4] pt-3">
                    <button type="button" className="text-sm font-bold text-[#007464]" onClick={() => setAllCaseNotesModalOpen(true)}>Read full note</button>
                    <button type="button" className="grid h-8 w-8 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#2e6fa3]" title="Edit case note" onClick={() => editCaseNote(index)}><PencilLine className="h-4 w-4" /></button>
                  </div>
                </article>)}
              </div> : <div className="rounded-md border border-dashed border-[#d8dee8] bg-[#f8fafc] px-4 py-10 text-center text-sm font-semibold text-[#64748b]">No case notes captured yet.</div>}
              {caseNotes.length > 3 && <div className="mt-4 text-center"><button type="button" className="text-sm font-bold text-[#007464] hover:underline" onClick={() => setAllCaseNotesModalOpen(true)}>View {caseNotes.length - 3} more case note{caseNotes.length - 3 === 1 ? "" : "s"}</button></div>}
            </SectionCard>
          </div>
        )}

        {activeTab === "attachments" && (
          <div className="space-y-5">
            <SectionCard title="Attachments" action={<button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white" onClick={addCaseDocument}><Plus className="h-4 w-4" /> Add Document</button>}>
              {visibleAttachments.length ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {visibleAttachments.map((document, index) => {
                    const canManageDocument = document.source === "case" && document.originalIndex !== undefined
                    const isImage = Boolean(document.previewUrl && (document.documentType === "Photo" || /\.(png|jpe?g|gif|webp)$/i.test(document.fileName)))
                    return (
                      <article key={`${document.source}-${document.fileName}-${index}`} className="overflow-hidden rounded-md border border-[#d8dee8] bg-white">
                        <div className="grid aspect-[16/9] place-items-center bg-[#f8fafc]">
                          {isImage ? <img src={document.previewUrl} alt={document.fileName} className="h-full w-full object-cover" /> : <File className="h-10 w-10 text-[#8aa0bf]" />}
                        </div>
                        <div className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-bold text-[#263747]">{document.fileName}</div>
                              <div className="mt-1 text-xs font-semibold text-[#64748b]">{document.documentType || "Attachment"}</div>
                            </div>
                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${document.source === "public" ? "bg-[#e7f0fb] text-[#2e6fa3]" : "bg-[#e7f6f3] text-[#007464]"}`}>{document.sourceLabel}</span>
                          </div>
                          {document.notes ? <p className="line-clamp-2 text-sm font-semibold text-[#64748b]">{document.notes}</p> : null}
                          <div className="flex items-center justify-between gap-2 border-t border-[#edf0f4] pt-3">
                            <button type="button" className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747] disabled:cursor-not-allowed disabled:opacity-50" disabled={!document.previewUrl} onClick={() => openAttachmentPreview(document)}>Open preview</button>
                            {canManageDocument ? (
                              <div className="flex items-center gap-2">
                                <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#2e6fa3] hover:border-[#008c7a] hover:text-[#008c7a]" title="Edit document" onClick={() => editCaseDocument(document.originalIndex!)}>
                                  <PencilLine className="h-4 w-4" />
                                </button>
                                <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#f4b4ac] bg-white text-[#b42318] hover:bg-[#fff7f5]" title="Delete document" onClick={() => requestDelete("Delete attachment?", "This case attachment will be removed from the case record.", () => removeCaseDocument(document.originalIndex!))}>
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-[#cfd8e6] bg-[#f8fafc] px-4 py-10 text-center text-sm font-semibold text-[#64748b]">No attachments yet.</div>
              )}
            </SectionCard>
          </div>
        )}

        {activeTab === "monitoring" && (
          <div className="space-y-5">
            <SectionCard title="Monitoring and Follow-up" action={<button disabled={!monitoringFollowUpAllowed} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#94a3b8]" onClick={() => openMonitoringModal("add")} title={monitoringFollowUpAllowed ? "Add follow-up" : "An intervention must be Referred, In Progress, or Completed first"}><Plus className="h-4 w-4" /> Add Follow-up</button>}>
              <p className="mb-3 text-sm font-semibold text-[#64748b]">Record follow-up contact with the child or family and assess progress following implementation of the care plan.</p>
              <div className="w-full max-w-full overflow-x-auto rounded-md border border-[#d8dee8]">
                <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
                  <thead className="bg-[#f8fafc] text-[#2e6fa3]">
                    <tr>{["Follow-up Date", "Care Plan Activity", "Follow-up Type", "Person(s) Seen", "Findings", "Outcome", "Next Follow-up", "Action"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr>
                  </thead>
                  <tbody>{monitoringRecords.length ? monitoringRecords.map((record, index) => (
                    <tr key={record.id} className="bg-white">
                      <td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]">{record.followUpDate}</td>
                      <td className="max-w-[220px] border-b border-[#edf0f4] px-3 py-3"><div className="truncate font-semibold text-[#263747]" title={record.carePlanItemFollowedUp || undefined}>{record.carePlanItemFollowedUp || record.areasMonitored.map(areaLabel).join(", ") || "-"}</div>{record.carePlanItemStatusAtFollowUp && <div className="mt-1 text-xs text-[#64748b]">{record.carePlanItemStatusAtFollowUp}</div>}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{record.followUpType}</td>
                      <td className="max-w-[220px] border-b border-[#edf0f4] px-3 py-3">{record.personsContacted.join(", ") || "-"}</td>
                      <td className="max-w-[300px] border-b border-[#edf0f4] px-3 py-3">{record.overallFindings}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{record.overallOutcome}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">{record.nextFollowUpDate || "-"}</td>
                      <td className="border-b border-[#edf0f4] px-3 py-3">
                        <div className="flex items-center gap-2">
                          <button type="button" className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => openMonitoringModal("view", index)}>View</button>
                          {canManage && <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#2e6fa3] hover:border-[#008c7a] hover:text-[#008c7a]" title="Edit follow-up" onClick={() => openMonitoringModal("edit", index)}><PencilLine className="h-4 w-4" /></button>}
                          {canManage && <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#f4b4ac] bg-white text-[#b42318] hover:bg-[#fff7f5]" title="Delete follow-up" onClick={() => requestDelete("Delete monitoring follow-up?", "This monitoring follow-up record will be removed from the case.", () => removeMonitoringRecord(index))}><Trash2 className="h-4 w-4" /></button>}
                        </div>
                      </td>
                    </tr>
                  )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={8}>No follow-up has been recorded yet.</td></tr>}</tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        )}

        {activeTab === "review" && (
          <div className="space-y-5">
            <SectionCard title="Case Review">
              <div className="mb-3 flex justify-end">
                <button className="rounded-md bg-[#008c7a] px-4 py-2 text-sm font-semibold text-white" onClick={startCaseReview}>+ Start Case Review</button>
              </div>
              <div className="overflow-x-auto rounded-md border border-[#d8dee8]">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Date", "Outcome", "Risk Level", "Decision", "Officer", "Action"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
                  <tbody>{caseReviews.length ? caseReviews.map((review) => <tr key={review.id}><td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]">{review.reviewDate}</td><td className="border-b border-[#edf0f4] px-3 py-3">{review.outcome}</td><td className="border-b border-[#edf0f4] px-3 py-3">{review.riskLevel}</td><td className="border-b border-[#edf0f4] px-3 py-3">{review.finalDecision}</td><td className="border-b border-[#edf0f4] px-3 py-3">{review.createdBy}</td><td className="border-b border-[#edf0f4] px-3 py-3"><button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => { setCaseReviewDraft(review); setCaseReviewModalOpen(true) }}>View</button></td></tr>) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={6}>No case review has been recorded yet.</td></tr>}</tbody>
                </table>
              </div>
              <div className="mt-4 rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
                <h4 className="mb-3 font-bold text-[#263747]">Revised Care Plan</h4>
                {latestCarePlanRevision() ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-3">
                      <Info label="Current Version" value={`Version ${latestCarePlanRevision()?.versionNumber}`} />
                      <Info label="Revision Date" value={formatWorkflowDateTime(latestCarePlanRevision()?.createdAt || "")} />
                      <Info label="Revised By" value={latestCarePlanRevision()?.createdBy || "Not recorded"} />
                    </div>
                    <Info label="Reason for Revision" value={latestCarePlanRevision()?.reasonForChange || "Not recorded"} />
                    <div className="flex justify-end gap-2"><button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setActiveTab("care")}>View Full Care Plan</button><button className="rounded-md bg-[#008c7a] px-3 py-2 text-sm font-semibold text-white" onClick={goToCarePlanForRevision}>Revise Care Plan</button></div>
                  </div>
                ) : <div className="text-sm font-semibold text-[#64748b]">No revised care plan has been saved yet.</div>}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <StatusPill label={row.caseReviewStatus || "20-day review cycle"} tone={row.caseReviewStatus === "Review required" ? "warning" : "review"} />
              </div>
            </SectionCard>
          </div>
        )}

        {activeTab === "closure" && (
          <div className="space-y-5">
            <SectionCard title="Case Closure">
              <div className="mb-3"><StatusPill label={closureStatus} tone="review" /></div>
              <div className="mb-4 overflow-x-auto rounded-md border border-[#d8dee8]">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Requirement", "Status"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
                  <tbody>{closureReadinessItems().map(([requirement, met]) => <tr key={requirement}><td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]">{requirement}</td><td className="border-b border-[#edf0f4] px-3 py-3"><StatusPill label={met ? "✓ Ready" : "🟡 Pending"} tone={met ? "review" : "warning"} /></td></tr>)}</tbody>
                </table>
              </div>
              <div className="mb-3 flex justify-end"><button className="rounded-md bg-[#008c7a] px-4 py-2 text-sm font-semibold text-white" onClick={() => setClosureModalOpen(true)}>Recommend Case Closure</button></div>
              <div className="overflow-x-auto rounded-md border border-[#d8dee8]">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Date", "Recommended By", "Decision", "Status", "Approved By"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
                  <tbody>{closureHistory.length ? closureHistory.map((record) => <tr key={record.id}><td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]">{formatWorkflowDateTime(record.recommendedAt)}</td><td className="border-b border-[#edf0f4] px-3 py-3">{record.recommendedBy}</td><td className="border-b border-[#edf0f4] px-3 py-3">{record.decision}</td><td className="border-b border-[#edf0f4] px-3 py-3">{record.status}</td><td className="border-b border-[#edf0f4] px-3 py-3">{record.approvedBy || "-"}</td></tr>) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={5}>No closure recommendation has been recorded yet.</td></tr>}</tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        )}
        </fieldset>
        {!canManage && approvalPending && activeTab === "assessment" && (
          <ApprovalReviewPanel
            title="Assessment Review"
            notes={approvalReviewNotes}
            setNotes={setApprovalReviewNotes}
            reviewing={approvalReviewing}
            approveLabel="Approve Assessment"
            onApprove={() => void reviewAssessmentCarePlan("assessment", "approve")}
            onReturn={() => void reviewAssessmentCarePlan("assessment", "request_revision")}
          />
        )}
        {!canManage && carePlanStatus === "Assessment Approved" && activeTab === "care" && (
          <ApprovalReviewPanel
            title="Care Plan Review"
            notes={approvalReviewNotes}
            setNotes={setApprovalReviewNotes}
            reviewing={approvalReviewing}
            approveLabel="Approve Care Plan"
            onApprove={() => void reviewAssessmentCarePlan("care_plan", "approve")}
            onReturn={() => void reviewAssessmentCarePlan("care_plan", "request_revision")}
          />
        )}
      </Panel>
      {approvalDialog && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-[#102033]/55 p-4">
          <div className="w-full max-w-md rounded-md bg-white p-6 text-center shadow-2xl">
            <CheckCircle2 className="mx-auto h-12 w-12 text-[#008c7a]" />
            <h3 className="mt-4 text-xl font-bold text-[#263747]">{approvalDialog.title}</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7191]">{approvalDialog.detail}</p>
            <button className="mt-6 rounded-md bg-[#008c7a] px-6 py-2.5 font-semibold text-white" onClick={() => { const nextTab = approvalDialog.nextTab; setApprovalDialog(null); if (nextTab) { setActiveTab(nextTab); window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" })) } }}>OK{approvalDialog.nextTab ? " — Continue to Care Plan" : ""}</button>
          </div>
        </div>
      )}
      {submissionDialogOpen && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-[#102033]/55 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#cfe4df] bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#e7f6f3] text-[#008c7a]">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h3 className="mt-4 text-xl font-bold text-[#263747]">Submitted successfully</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7191]">The Assessment &amp; Care Plan has been sent to the DSDO for review. This case is read-only until a decision is recorded.</p>
            <button autoFocus className="mt-6 min-w-28 rounded-md bg-[#008c7a] px-6 py-2.5 font-semibold text-white hover:bg-[#007464]" onClick={() => setSubmissionDialogOpen(false)}>OK</button>
          </div>
        </div>
      )}
      {closureModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-md border border-[#d8dee8] bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#dfe4eb] bg-white px-5 py-4">
              <div>
                <h3 className="text-xl font-extrabold text-[#263747]">Recommend Case Closure</h3>
                <div className="text-sm font-semibold text-[#64748b]">{row.id}</div>
              </div>
              <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setClosureModalOpen(false)}>Close</button>
            </div>
            <div className="space-y-4 p-5">
              {careModalError && <div role="alert" className="rounded-md border border-[#f4b4ac] bg-[#fff7f5] px-4 py-3 text-sm font-semibold text-[#b42318]">{careModalError}</div>}
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">Case Summary</h4>
                <div className="grid gap-3 md:grid-cols-3">
                  <Info label="Supervisor" value="District Supervisor" />
                  <Info label="Child" value={`${row.childName} | ${row.age} / ${row.sex}`} />
                  <Info label="Case Open Date" value={formatWorkflowDateTime(row.createdAt)} />
                  <Info label="Latest Monitoring Outcome" value={latestMonitoringRecord?.overallOutcome || "Not recorded"} />
                  <Info label="Care Plan Progress" value={`${completedTasks.length}/${meaningfulImplementationTasks.length} tasks completed`} />
                </div>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">Reason for Closure</h4>
                <div className="flex flex-wrap gap-2">
                  {closureReasons.map((reason) => <button key={reason} type="button" className={`rounded-full border px-3 py-1 text-xs font-bold ${closureDraft.reasons.includes(reason) ? "border-[#008c7a] bg-[#e7f6f3] text-[#007464]" : "border-[#d8dee8] bg-white text-[#64748b]"}`} onClick={() => toggleClosureReason(reason)}>{reason}</button>)}
                </div>
                {closureDraft.reasons.includes("Other") && <div className="mt-3"><Field label="Other reason explanation"><input className={inputClass} value={closureDraft.otherReason} onChange={(event) => setClosureDraftValue("otherReason", event.target.value)} /></Field></div>}
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h4 className="mb-1 text-sm font-extrabold uppercase text-[#2e6fa3]">Process Completed</h4>
                <p className="mb-3 text-sm text-[#64748b]">Check all that apply.</p>
                <div className="space-y-3">
                  {([
                    ["childFamilyDiscussionAgreed", "There has been discussion with the child and/or family, and they agree with the decision."],
                    ["safetyConcernsResolved", "Problems have been adequately addressed and there are no longer concerns for the child’s safety."],
                    ["carePlanGoalsMet", "The goals of the care plan have been met."],
                    ["childAwareOfResources", "The child has been made aware of resources available if another child protection need arises."],
                    ["childEndingAgainstAdvice", "The child is electing to end services against the advice of the care worker."],
                  ] as Array<[keyof ClosureProcessCompleted, string]>).map(([key, label]) => (
                    <label key={key} className="flex cursor-pointer items-start gap-3 rounded-md border border-[#d8dee8] px-3 py-3 text-sm font-medium text-[#263747] hover:bg-[#f8fafc]">
                      <input className="mt-0.5 h-4 w-4 accent-[#008c7a]" type="checkbox" checked={closureDraft.processCompleted[key]} onChange={() => toggleClosureProcessCompleted(key)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">Description of the Decision</h4>
                <FormGrid>
                  <div className="md:col-span-2"><Field label="Decision description"><textarea className={`${inputClass} min-h-[120px] py-3`} value={closureDraft.currentSituation} onChange={(event) => setClosureDraftValue("currentSituation", event.target.value)} placeholder="If care-plan goals were met, describe the child’s current situation against the care-plan objectives and activities. If the child is ending services, describe efforts to resolve concerns without ending services." /></Field></div>
                </FormGrid>
              </section>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[#dfe4eb] bg-white px-5 py-4">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={() => setClosureModalOpen(false)}>Cancel</button>
              <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={submitClosure}>Submit for Approval</button>
            </div>
          </div>
        </div>
      )}
      {caseReviewModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-md border border-[#d8dee8] bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#dfe4eb] bg-white px-5 py-4">
              <div>
                <h3 className="text-xl font-extrabold text-[#263747]">Start Case Review</h3>
                <div className="text-sm font-semibold text-[#64748b]">{row.id}</div>
              </div>
              <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setCaseReviewModalOpen(false)}>Close</button>
            </div>
            <div className="space-y-4 p-5">
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">1. Auto-generated Review Summary</h4>
                <div className="space-y-3">
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="rounded-md bg-[#f8fafc] p-4">
                      <div className="text-xs font-extrabold uppercase text-[#64748b]">Assessment Summary</div>
                      <div className="mt-2 whitespace-pre-line text-sm font-semibold leading-6 text-[#102033]">{childStorySummary}</div>
                    </div>
                    <div className="rounded-md bg-[#f8fafc] p-4">
                      <div className="text-xs font-extrabold uppercase text-[#64748b]">Monitoring Summary</div>
                      {latestMonitoringRecord ? (
                        <div className="mt-2 space-y-2 text-sm font-semibold leading-6 text-[#102033]">
                          <div>{monitoringRecords.length} monitoring visit{monitoringRecords.length === 1 ? "" : "s"} recorded. Latest outcome: {latestMonitoringRecord.overallOutcome || "Not recorded"}.</div>
                          <div className="grid gap-2 text-xs text-[#52657a] sm:grid-cols-3">
                            <span>Latest date: {latestMonitoringRecord.followUpDate || "Not recorded"}</span>
                            <span>Child safe: {latestMonitoringRecord.childSafe || "Not confirmed"}</span>
                            <span>Next follow-up: {latestMonitoringRecord.nextFollowUpDate || "Not scheduled"}</span>
                          </div>
                        </div>
                      ) : <div className="mt-2 text-sm font-semibold leading-6 text-[#102033]">No monitoring recorded.</div>}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Info label="Care Plan Progress" value={`${completedTasks.length}/${meaningfulImplementationTasks.length} tasks completed`} />
                    <Info label="Referral Summary" value={recordedReferrals.length ? `${recordedReferrals.length} referral${recordedReferrals.length === 1 ? "" : "s"}` : "No referral recorded"} />
                    <Info label="Significant Events" value={`${recordedCaseNotes.length} case note${recordedCaseNotes.length === 1 ? "" : "s"}`} />
                    <Info label="Current Risk" value={row.riskLevel} />
                  </div>
                </div>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">2. Review Findings</h4>
                <FormGrid>
                  <Field label="Review Date"><input className={inputClass} type="date" value={caseReviewDraft.reviewDate} onChange={(event) => setCaseReviewDraftValue("reviewDate", event.target.value)} /></Field>
                  <Field label="Review Outcome"><select className={inputClass} value={caseReviewDraft.outcome} onChange={(event) => setCaseReviewDraftValue("outcome", event.target.value)}><option value="">Select outcome</option>{["Significant Improvement", "Moderate Improvement", "No Change", "Deteriorating", "Case Stabilized"].map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <Field label="Current Risk Level"><select className={inputClass} value={caseReviewDraft.riskLevel} onChange={(event) => setCaseReviewDraftValue("riskLevel", event.target.value)}>{["Critical", "High", "Medium", "Low"].map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <Field label="Care Plan Decision"><select className={inputClass} value={caseReviewDraft.carePlanDecision} onChange={(event) => setCaseReviewDraftValue("carePlanDecision", event.target.value)}><option value="">Select decision</option>{["Continue Current Care Plan", "Modify Existing Care Plan", "Add New Care Plan Items", "Escalate Case", "Prepare for Closure", "Continue Monitoring"].map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <div className="md:col-span-2"><Field label="New Problems/Needs Since Last Review"><textarea className={`${inputClass} min-h-[90px] py-3`} value={caseReviewDraft.newProblems} onChange={(event) => setCaseReviewDraftValue("newProblems", event.target.value)} placeholder="Describe new issues, barriers, or needs identified since previous review." /></Field></div>
                  <div className="md:col-span-2"><Field label="Officer Analysis"><textarea className={`${inputClass} min-h-[110px] py-3`} value={caseReviewDraft.officerAnalysis} onChange={(event) => setCaseReviewDraftValue("officerAnalysis", event.target.value)} placeholder="Provide professional assessment of progress, remaining risks, effectiveness of interventions, and family/child situation." /></Field></div>
                </FormGrid>
              </section>
              {["Modify Existing Care Plan", "Add New Care Plan Items"].includes(caseReviewDraft.carePlanDecision) && (
                <section className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
                  <h4 className="mb-2 font-bold text-[#263747]">Revised Care Plan Required</h4>
                  <p className="text-sm font-semibold text-[#64748b]">Care plan changes must be completed from the Care Plan tab using the structured care plan items.</p>
                  <button className="mt-3 rounded-md bg-[#008c7a] px-4 py-2 text-sm font-semibold text-white" onClick={goToCarePlanForRevision}>Go to Care Plan to Request Change</button>
                </section>
              )}
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">3. Review Decision</h4>
                <Field label="Final Recommendation"><select className={inputClass} value={caseReviewDraft.finalDecision} onChange={(event) => setCaseReviewDraftValue("finalDecision", event.target.value)}><option value="">Select recommendation</option>{["Continue Case", "Continue With Revised Plan", "Escalate", "Recommend Closure"].map((item) => <option key={item}>{item}</option>)}</select></Field>
              </section>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[#dfe4eb] bg-white px-5 py-4">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={() => setCaseReviewModalOpen(false)}>Cancel</button>
              <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={saveCaseReview}>Complete Case Review</button>
            </div>
          </div>
        </div>
      )}
      {deleteConfirmation && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-[#102033]/55 p-4">
          <div className="w-full max-w-md rounded-md border border-[#d8dee8] bg-white shadow-2xl">
            <div className="border-b border-[#dfe4eb] px-5 py-4">
              <h3 className="text-lg font-extrabold text-[#263747]">{deleteConfirmation.title}</h3>
            </div>
            <div className="space-y-3 px-5 py-4">
              <p className="text-sm font-semibold text-[#64748b]">{deleteConfirmation.detail}</p>
              <p className="text-sm font-bold text-[#b42318]">Are you sure you want to continue?</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#dfe4eb] px-5 py-4">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={() => setDeleteConfirmation(null)}>Cancel</button>
              <button className="rounded-md bg-[#b42318] px-4 py-2 font-semibold text-white" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
      {carePlanChangeRequestOpen && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-[#102033]/55 p-4">
          <div className="w-full max-w-xl rounded-md border border-[#d8dee8] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#dfe4eb] px-5 py-4">
              <div>
                <h3 className="text-xl font-extrabold text-[#263747]">Request Care Plan Change</h3>
                <p className="mt-1 text-sm font-semibold text-[#64748b]">{row.id} | Submit the proposed change to the DSDO.</p>
              </div>
              <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setCarePlanChangeRequestOpen(false)}>Close</button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="rounded-md border border-[#9ee2d8] bg-[#effcf9] p-4 text-sm font-semibold text-[#176b61]">
                The proposed changes will remain pending and will not affect the active care plan until the DSDO approves them.
              </div>
              {carePlanChangeStage === "choose" ? <>
                <Field label="Type of Change" required>
                  <select className={inputClass} value={carePlanChangeMode} onChange={(event) => { setCarePlanChangeMode(event.target.value as "" | "create" | "update"); setCarePlanChangeTargetIndex(null) }}>
                    <option value="">Select change type</option>
                    <option value="create">Create New Care Plan Activity</option>
                    <option value="update">Update Existing Care Plan Activity</option>
                  </select>
                </Field>
                {carePlanChangeMode === "update" && <Field label="Activity to Update" required><select className={inputClass} value={carePlanChangeTargetIndex ?? ""} onChange={(event) => setCarePlanChangeTargetIndex(event.target.value === "" ? null : Number(event.target.value))}><option value="">Select activity</option>{careRows.map((item, index) => <option key={`${item.assistanceType}-${index}`} value={index}>{item.assistanceType || item.plannedAction || `Activity ${index + 1}`}</option>)}</select></Field>}
              </> : <Field label="Reason for Change" required>
                <textarea className={`${inputClass} min-h-[120px] py-3`} value={carePlanRevisionReason} onChange={(event) => setCarePlanRevisionReason(event.target.value)} placeholder="Explain why this change is required." />
              </Field>}
            </div>
            <div className="flex justify-end gap-2 border-t border-[#dfe4eb] px-5 py-4">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={() => setCarePlanChangeRequestOpen(false)}>Cancel</button>
              <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={carePlanChangeStage === "choose" ? beginCarePlanChange : saveCarePlanRevision}>{carePlanChangeStage === "choose" ? "Continue" : "Send Request to DSDO"}</button>
            </div>
          </div>
        </div>
      )}
      {careModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-md border border-[#d8dee8] bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#dfe4eb] bg-white px-5 py-4">
              <div>
                <h3 className="text-xl font-extrabold text-[#263747]">{careModalIndex === null ? "Add Care Plan Activity" : "Edit Care Plan Activity"}</h3>
                <div className="mt-1 text-sm font-semibold text-[#64748b]">{row.id} | Care plan activity</div>
              </div>
              <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setCareModalOpen(false)}>Close</button>
            </div>
            <div className="space-y-4 p-5">
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">1. Care Plan Activity</h4>
                <FormGrid>
                  <Field label="Care Plan Activity" required>
                    <select className={inputClass} value={careDraft.assistanceType} onChange={(event) => setCareDraftValue("assistanceType", event.target.value)}>
                      <option value="">Select</option>
                      {careAssistanceTypes.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </Field>
                  {careDraft.assistanceType === "Other" && (
                    <div className="md:col-span-2">
                      <Field label="Other Assistance Description" required>
                        <textarea className={`${inputClass} min-h-[90px] py-3`} value={careDraft.otherAssistanceDescription || ""} onChange={(event) => setCareDraftValue("otherAssistanceDescription", event.target.value)} placeholder="Describe the assistance type that is not listed above." />
                      </Field>
                    </div>
                  )}
                </FormGrid>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">2. Activity Description</h4>
                <Field label="Activity Description" required><textarea className={`${inputClass} min-h-[110px] py-3`} value={careDraft.plannedAction} onChange={(event) => setCareDraftValue("plannedAction", event.target.value)} placeholder="Describe the activity, service or support to be provided." /></Field>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">3. Responsibility and Target Date</h4>
                <FormGrid>
                  <Field label="Responsible Person" required><select className={inputClass} value={careDraft.responsiblePerson || ""} onChange={(event) => setCareDraftValue("responsiblePerson", event.target.value)}><option value="">Select</option>{careResponsibleOptions.map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <Field label="Target Date" required><input className={inputClass} type="date" value={careDraft.dueDate} onChange={(event) => setCareDraftValue("dueDate", event.target.value)} /></Field>
                  {careDraft.responsiblePerson === "Other" && <>
                    <Field label="Specify Responsible Person or Organisation" required><input className={inputClass} value={careDraft.otherResponsiblePerson || ""} onChange={(event) => setCareDraftValue("otherResponsiblePerson", event.target.value)} placeholder="Enter the person, team, or organisation" /></Field>
                    <Field label="Is a Formal Referral Required?" required><select className={inputClass} value={careDraft.referralRequired || ""} onChange={(event) => setCareDraftValue("referralRequired", event.target.value)}><option value="">Select</option><option>Yes</option><option>No</option></select></Field>
                  </>}
                  {careDraft.responsiblePerson && careDraft.responsiblePerson !== "Other" && <div className={`md:col-span-2 rounded-md border px-3 py-2 text-sm font-semibold ${careDraft.referralRequired === "Yes" ? "border-[#f4d38a] bg-[#fff8e6] text-[#8a5a12]" : "border-[#b7e4d8] bg-[#effcf9] text-[#176b61]"}`}>{careDraft.referralRequired === "Yes" ? "A formal referral will be required for this activity." : "A formal referral is not required for this responsibility."}</div>}
                </FormGrid>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">4. Action Plan Notes</h4>
                <Field label="Action Plan Notes"><textarea className={`${inputClass} min-h-[90px] py-3`} value={careDraft.actionPlanNotes} onChange={(event) => setCareDraftValue("actionPlanNotes", event.target.value)} placeholder="Record the action plan notes for this care plan activity." /></Field>
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
              <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={saveCareIntervention}>Save Care Plan Activity</button>
            </div>
          </div>
        </div>
      )}
      {caseConferenceModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-md border border-[#d8dee8] bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#dfe4eb] bg-white px-5 py-4">
              <div>
                <h3 className="text-xl font-extrabold text-[#263747]">{caseConferenceModalIndex === null ? "Record Case Conference" : "Edit Case Conference"}</h3>
                <div className="mt-1 text-sm font-semibold text-[#64748b]">{row.id} | Care plan conference</div>
              </div>
              <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setCaseConferenceModalOpen(false)}>Close</button>
            </div>
            <div className="space-y-4 p-5">
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <FormGrid>
                  <Field label="Conference Date"><input className={inputClass} type="date" value={caseConferenceDraft.date} onChange={(event) => setCaseConferenceDraft((current) => ({ ...current, date: event.target.value }))} /></Field>
                </FormGrid>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
                <Field label="Participants">
                  <textarea className={`${inputClass} min-h-[110px] bg-white py-3`} value={caseConferenceDraft.participants} onChange={(event) => setCaseConferenceDraft((current) => ({ ...current, participants: event.target.value }))} placeholder="Enter each participant on a new line, for example: school representative, CCW, caregiver, clinic." />
                </Field>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <Field label="Agreements">
                  <textarea className={`${inputClass} min-h-[130px] py-3`} value={caseConferenceDraft.decisions} onChange={(event) => setCaseConferenceDraft((current) => ({ ...current, decisions: event.target.value }))} placeholder="Enter each agreed decision on a new line. These decisions can then be added as care plan activities." />
                </Field>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <Field label="Conference Notes">
                  <textarea className={`${inputClass} min-h-[90px] py-3`} value={caseConferenceDraft.notes} onChange={(event) => setCaseConferenceDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional notes about the discussion, attendance or follow-up." />
                </Field>
              </section>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[#dfe4eb] bg-white px-5 py-4">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={() => setCaseConferenceModalOpen(false)}>Cancel</button>
              <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={saveCaseConference}>Save Case Conference</button>
            </div>
          </div>
        </div>
      )}
      {courtOrderModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-md border border-[#d8dee8] bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#dfe4eb] bg-white px-5 py-4">
              <div>
                <h3 className="text-xl font-extrabold text-[#263747]">{courtOrderModalIndex === null ? "Add Court Order" : "Edit Court Order"}</h3>
                <div className="mt-1 text-sm font-semibold text-[#64748b]">{row.id} | Court Orders</div>
              </div>
              <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setCourtOrderModalOpen(false)}>Close</button>
            </div>
            <div className="space-y-4 p-5">
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <FormGrid>
                  <Field label="Court Order Type"><select className={inputClass} value={courtOrderDraft.courtOrderType} onChange={(event) => setCourtOrderDraft((current) => ({ ...current, courtOrderType: event.target.value }))}><option value="">Select court order type</option>{courtOrderTypes.map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <Field label="Court Name">
                    <input className={inputClass} list={courtNameSuggestionsId} value={courtOrderDraft.courtName} placeholder={`Type to find a registered court in ${row.district || "this district"}`} onChange={(event) => setCourtOrderDraft((current) => ({ ...current, courtName: event.target.value }))} />
                    <datalist id={courtNameSuggestionsId}>{districtCourtNames.map((courtName) => <option key={courtName} value={courtName} />)}</datalist>
                    <p className="mt-1 text-xs font-medium text-[#64748b]">{districtCourtNames.length ? `Showing registered courts for ${row.district}.` : `No registered courts are available for ${row.district || "this case's district"}.`}</p>
                  </Field>
                  <Field label="Court Case Number"><input className={inputClass} value={courtOrderDraft.courtCaseNumber} onChange={(event) => setCourtOrderDraft((current) => ({ ...current, courtCaseNumber: event.target.value }))} /></Field>
                  <Field label="Date Issued"><input className={inputClass} type="date" value={courtOrderDraft.dateIssued} onChange={(event) => setCourtOrderDraft((current) => ({ ...current, dateIssued: event.target.value }))} /></Field>
                  <Field label="Expiry Date (Optional)"><input className={inputClass} type="date" value={courtOrderDraft.expiryDate} onChange={(event) => setCourtOrderDraft((current) => ({ ...current, expiryDate: event.target.value }))} /></Field>
                  <Field label="Status"><select className={inputClass} value={courtOrderDraft.status} onChange={(event) => setCourtOrderDraft((current) => ({ ...current, status: event.target.value }))}><option>Active</option><option>Completed</option><option>Expired</option><option>Revoked</option></select></Field>
                  <div className="md:col-span-2"><Field label="Court Decision"><textarea className={`${inputClass} min-h-[100px] py-3`} value={courtOrderDraft.courtDecision || ""} onChange={(event) => setCourtOrderDraft((current) => ({ ...current, courtDecision: event.target.value }))} /></Field></div>
                  <div className="md:col-span-2"><Field label="Additional Notes (Optional)"><textarea className={`${inputClass} min-h-[100px] py-3`} value={courtOrderDraft.notes} onChange={(event) => setCourtOrderDraft((current) => ({ ...current, notes: event.target.value }))} /></Field></div>
                </FormGrid>
              </section>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[#dfe4eb] bg-white px-5 py-4">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={() => setCourtOrderModalOpen(false)}>Cancel</button>
              <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={saveCourtOrder}>Save Court Order</button>
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
              <div className="flex items-center gap-2">
                {referralModalIndex !== null && (
                  <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]" title="Download referral PDF" onClick={() => void downloadReferralPdf(referralModalIndex)}>
                    <Printer className="h-4 w-4" />
                  </button>
                )}
                <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setReferralModalOpen(false)}>Close</button>
              </div>
            </div>
            <FormGrid>
              <Field label="Care Plan Activity" required>{referralActivityLocked ? <div className="flex h-11 items-center rounded-md border border-[#d8dee8] bg-[#f3f6f9] px-3 font-semibold text-[#263747]" aria-readonly="true">{referralDraft.linkedCarePlanItem}</div> : <select className={inputClass} value={referralDraft.linkedCarePlanItem} onChange={(event) => setReferralDraftValue("linkedCarePlanItem", event.target.value)}><option value="">Select care plan activity</option>{careRows.map((item, index) => <option key={`${item.assistanceType}-${index}`} value={item.assistanceType || item.plannedAction}>{item.assistanceType || item.plannedAction}{carePlanRequiresReferral(item) ? " — Required" : ""}</option>)}</select>}</Field>
              <Field label="Referral Type"><select className={inputClass} value={referralDraft.type} onChange={(event) => setReferralDraftValue("type", event.target.value)}><option value="">Select referral type</option>{referralTypes.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Referral Agency">
                <input
                  className={inputClass}
                  list={referralDraft.type === "Place of Safety" ? placeOfSafetySuggestionsId : undefined}
                  value={referralDraft.referralAgency}
                  placeholder={referralDraft.type === "Place of Safety" ? `Type to find a registered place of safety in ${row.district || "this district"}` : "Enter referral agency"}
                  onChange={(event) => referralDraft.type === "Place of Safety" ? setPlaceOfSafetyReferralAgency(event.target.value) : setReferralDraftValue("referralAgency", event.target.value)}
                />
                {referralDraft.type === "Place of Safety" && <>
                  <datalist id={placeOfSafetySuggestionsId}>{districtPlacesOfSafety.map((place) => <option key={place.id} value={place.partner_name} />)}</datalist>
                  <p className="mt-1 text-xs font-medium text-[#64748b]">{districtPlacesOfSafety.length ? `Showing registered places of safety for ${row.district}.` : `No registered places of safety are available for ${row.district || "this case's district"}.`}</p>
                </>}
              </Field>
              <Field label="Contact Person (Optional)"><input className={inputClass} value={referralDraft.contactPerson} onChange={(event) => setReferralDraftValue("contactPerson", event.target.value)} /></Field>
              <Field label="Address (Optional)"><input className={inputClass} value={referralDraft.address} onChange={(event) => setReferralDraftValue("address", event.target.value)} /></Field>
              <Field label="Telephone (Optional)"><input className={inputClass} value={referralDraft.telephone} onChange={(event) => setReferralDraftValue("telephone", event.target.value)} /></Field>
              <Field label="Referral Date"><input className={inputClass} type="date" value={referralDraft.date} onChange={(event) => setReferralDraftValue("date", event.target.value)} /></Field>
              <Field label="Follow-up Date" required><input className={inputClass} type="date" value={referralDraft.followUpDate} onChange={(event) => setReferralDraftValue("followUpDate", event.target.value)} /></Field>
              <div className="md:col-span-2"><Field label="Brief Circumstances of Child"><textarea className={`${inputClass} min-h-[90px] py-3`} value={referralDraft.briefCircumstances} onChange={(event) => setReferralDraftValue("briefCircumstances", event.target.value)} /></Field></div>
              <div className="md:col-span-2"><Field label="Reason for Referral"><textarea className={`${inputClass} min-h-[90px] py-3`} value={referralDraft.reason} onChange={(event) => setReferralDraftValue("reason", event.target.value)} /></Field></div>
              <div className="md:col-span-2"><Field label="Feedback Received"><textarea className={`${inputClass} min-h-[90px] py-3`} value={referralDraft.outcome} onChange={(event) => setReferralDraftValue("outcome", event.target.value)} /></Field></div>
            </FormGrid>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={() => setReferralModalOpen(false)}>Cancel</button>
              <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={saveReferral}>Save Referral</button>
            </div>
          </div>
        </div>
      )}
      {monitoringModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-md border border-[#d8dee8] bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#dfe4eb] bg-white px-5 py-4">
              <div>
                <h3 className="text-xl font-extrabold text-[#263747]">{monitoringModalMode === "view" ? "View Follow-up" : monitoringModalMode === "edit" ? "Edit Follow-up" : "Add Follow-up"}</h3>
                <div className="text-sm font-semibold text-[#64748b]">{row.id}</div>
              </div>
              <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setMonitoringModalOpen(false)}>Close</button>
            </div>
            <div className="space-y-4 p-5">
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">1. Follow-up Details</h4>
                <FormGrid>
                  <Field label="Follow-up Date"><input className={inputClass} type="date" disabled={monitoringModalMode === "view"} value={monitoringDraft.followUpDate} onChange={(event) => setMonitoringDraftValue("followUpDate", event.target.value)} /></Field>
                  <Field label="Follow-up Type"><select className={inputClass} disabled={monitoringModalMode === "view"} value={monitoringDraft.followUpType} onChange={(event) => setMonitoringDraftValue("followUpType", event.target.value)}><option value="">Select follow-up type</option>{followUpTypes.map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <div className="md:col-span-2">
                    <div className="mb-2 text-sm font-semibold text-[#263747]">Person(s) Seen or Contacted</div>
                    <div className="flex flex-wrap gap-2">
                      {personContactOptions.map((person) => (
                        <button key={person} type="button" disabled={monitoringModalMode === "view"} className={`rounded-full border px-3 py-1 text-xs font-bold ${monitoringDraft.personsContacted.includes(person) ? "border-[#008c7a] bg-[#e7f6f3] text-[#007464]" : "border-[#d8dee8] bg-white text-[#64748b]"}`} onClick={() => toggleMonitoringPerson(person)}>{person}</button>
                      ))}
                    </div>
                  </div>
                  {monitoringDraft.followUpType !== "Telephone Call" && <div className="md:col-span-2"><Field label="Location or Place Visited"><input className={inputClass} disabled={monitoringModalMode === "view"} value={monitoringDraft.location} onChange={(event) => setMonitoringDraftValue("location", event.target.value)} /></Field></div>}
                </FormGrid>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">2. Follow-up Findings</h4>
                <Field label="Care Plan Activity Followed Up">
                  <select className={inputClass} disabled={monitoringModalMode === "view"} value={monitoringDraft.carePlanItemFollowedUp} onChange={(event) => {
                    const selected = followUpCarePlanOptions.find((item) => item.value === event.target.value)
                    setMonitoringDraft((current) => ({ ...current, carePlanItemFollowedUp: event.target.value, carePlanItemStatusAtFollowUp: selected?.status || current.carePlanItemStatusAtFollowUp }))
                  }}>
                    <option value="">Select a referred, in-progress, or completed activity</option>
                    {followUpCarePlanOptions.map((item, index) => <option key={`${item.value}-${index}`} value={item.value}>{item.label} — {item.status}</option>)}
                  </select>
                </Field>
                <div className="mt-4"><Field label="Follow-up Findings"><textarea className={`${inputClass} min-h-[120px] py-3`} disabled={monitoringModalMode === "view"} value={monitoringDraft.overallFindings} onChange={(event) => setMonitoringDraftValue("overallFindings", event.target.value)} placeholder="Describe the child’s current situation, progress observed, challenges, feedback from the child or caregiver, and whether the care plan appears to be helping." /></Field></div>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-white p-4">
                <h4 className="mb-3 text-sm font-extrabold uppercase text-[#2e6fa3]">3. Outcome and Next Action</h4>
                <FormGrid>
                  <Field label="Overall Outcome"><select className={inputClass} disabled={monitoringModalMode === "view"} value={monitoringDraft.overallOutcome} onChange={(event) => setMonitoringDraftValue("overallOutcome", event.target.value)}><option value="">Select outcome</option>{["Improving", "Intervention Successful / Goal Achieved", "No Significant Change", "Situation Worsening", "Intervention Completed", "Unable to Confirm"].map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <Field label="Were any new protection concerns identified?"><select className={inputClass} disabled={monitoringModalMode === "view"} value={monitoringDraft.newRisksIdentified} onChange={(event) => setMonitoringDraftValue("newRisksIdentified", event.target.value)}><option value="">Select</option><option>No</option><option>Yes</option></select></Field>
                  {monitoringDraft.newRisksIdentified === "Yes" && <div className="md:col-span-2"><Field label="New Protection Concerns"><textarea className={`${inputClass} min-h-[100px] py-3`} disabled={monitoringModalMode === "view"} value={monitoringDraft.newRiskDetails} onChange={(event) => setMonitoringDraftValue("newRiskDetails", event.target.value)} placeholder="Describe the new protection concern identified and any immediate action taken." /></Field></div>}
                  <Field label="Next Action"><select className={inputClass} disabled={monitoringModalMode === "view"} value={monitoringDraft.recommendedNextStep} onChange={(event) => setMonitoringDraftValue("recommendedNextStep", event.target.value)}><option value="">Select next action</option>{["Continue Current Care Plan", "Follow Up Again", "Update Care Plan", "Create Referral", "Convene Case Conference", "No Further Follow-up Required"].map((item) => <option key={item}>{item}</option>)}</select></Field>
                  {nextActionRequiresFollowUpDate && <Field label="Next Follow-up Date (required)"><input className={inputClass} type="date" disabled={monitoringModalMode === "view"} value={monitoringDraft.nextFollowUpDate} onChange={(event) => setMonitoringDraftValue("nextFollowUpDate", event.target.value)} /></Field>}
                </FormGrid>
              </section>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[#dfe4eb] bg-white px-5 py-4">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={() => setMonitoringModalOpen(false)}>{monitoringModalMode === "view" ? "Close" : "Cancel"}</button>
              {monitoringModalMode !== "view" && monitoringDraft.newRisksIdentified === "Yes" && <button className="rounded-md border border-[#008c7a] bg-white px-5 py-2 font-semibold text-[#007464]" onClick={() => saveMonitoringRecord(true)}>Save Follow-up and Create Alert</button>}
              {monitoringModalMode !== "view" && <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={() => saveMonitoringRecord(false)}>Save Follow-up</button>}
            </div>
          </div>
        </div>
      )}
      {allCaseNotesModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4" role="dialog" aria-modal="true" aria-labelledby="all-case-notes-title">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-md border border-[#d8dee8] bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-[#dfe4eb] px-5 py-4">
              <div>
                <h3 id="all-case-notes-title" className="text-lg font-bold text-[#263747]">All Case Notes</h3>
                <div className="mt-0.5 text-sm font-semibold text-[#64748b]">{row.id} · {caseNotes.length} note{caseNotes.length === 1 ? "" : "s"}</div>
              </div>
              <button type="button" className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setAllCaseNotesModalOpen(false)}>Close</button>
            </div>
            <div className="space-y-3 overflow-y-auto bg-[#f8fafc] p-5">
              {[...caseNotes].map((note, index) => ({ note, index })).reverse().map(({ note, index }) => (
                <article key={`${index}-${note.caseNote.slice(0, 40)}`} className="rounded-md border border-[#d8dee8] bg-white p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-xs font-extrabold uppercase tracking-wide text-[#2e6fa3]">Case note {index + 1}</div>
                    <div className="flex gap-2">
                      <button type="button" className="grid h-8 w-8 place-items-center rounded-md border border-[#d8dee8] text-[#2e6fa3] hover:border-[#008c7a]" title="Edit case note" onClick={() => { setAllCaseNotesModalOpen(false); editCaseNote(index) }}><PencilLine className="h-4 w-4" /></button>
                      <button type="button" className="grid h-8 w-8 place-items-center rounded-md border border-[#f4b4ac] text-[#b42318] hover:bg-[#fff7f5]" title="Delete case note" onClick={() => requestDelete("Delete case note?", "This case note will be permanently removed from the activity log.", () => removeCaseNote(index))}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                  <p className="break-words whitespace-pre-wrap text-sm leading-6 text-[#263747]">{note.caseNote}</p>
                </article>
              ))}
            </div>
            <div className="flex justify-between gap-3 border-t border-[#dfe4eb] bg-white px-5 py-4">
              <button type="button" className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={() => setAllCaseNotesModalOpen(false)}>Close</button>
              <button type="button" className="inline-flex items-center gap-2 rounded-md bg-[#008c7a] px-4 py-2 font-semibold text-white" onClick={() => { setAllCaseNotesModalOpen(false); addCaseNote() }}><Plus className="h-4 w-4" /> Add Case Note</button>
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
            <Field label="Case Notes" required><textarea autoFocus className={`${inputClass} min-h-[260px] py-3`} value={caseNoteDraft.caseNote} onChange={(event) => setCaseNoteDraftValue("caseNote", event.target.value)} placeholder="Write the complete case note here." /></Field>
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
                <h3 className="text-lg font-bold text-[#263747]">Update Implementation</h3>
                <div className="text-sm font-semibold text-[#64748b]">{serviceDraft.plannedAction || row.id}</div>
              </div>
              <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setServiceModalOpen(false)}>Close</button>
            </div>
            <FormGrid>
              <Field label="Implementation Date"><input className={inputClass} type="date" value={serviceDraft.implementationDate} onChange={(event) => setServiceDraft((current) => ({ ...current, implementationDate: event.target.value }))} /></Field>
              <Field label="Status"><select className={inputClass} value={serviceDraft.status} onChange={(event) => setServiceDraft((current) => ({ ...current, status: event.target.value }))}>{serviceStatuses.map((item) => <option key={item}>{item}</option>)}</select></Field>
              {serviceModalProvider ? <div className="md:col-span-2"><Field label="Provider / Referral"><div className="rounded-md border border-[#d8dee8] bg-[#f8fafc] px-3 py-3 text-sm"><div className="font-bold text-[#263747]">{serviceModalProvider.agency}</div><div className="mt-1 text-[#64748b]">Service progress is recorded here under Implementation.</div></div></Field></div> : <Field label="Delivered By"><input className={inputClass} value={serviceDraft.deliveredBy} onChange={(event) => setServiceDraft((current) => ({ ...current, deliveredBy: event.target.value }))} placeholder="Person, team, or organisation delivering this activity" /></Field>}
              <div className="md:col-span-2"><Field label="Implementation Notes"><textarea className={`${inputClass} min-h-[100px] py-3`} value={serviceDraft.implementationNotes} onChange={(event) => setServiceDraft((current) => ({ ...current, implementationNotes: event.target.value }))} placeholder="Describe what was carried out and the result." /></Field></div>
            </FormGrid>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={() => setServiceModalOpen(false)}>Cancel</button>
              <button className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white" onClick={saveServiceProgress}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ApprovalReviewPanel({ title, notes, setNotes, reviewing, approveLabel, onApprove, onReturn }: { title: string; notes: string; setNotes: (value: string) => void; reviewing: boolean; approveLabel: string; onApprove: () => void; onReturn: () => void }) {
  return (
    <section className="mt-5 rounded-md border-2 border-[#b7e4d8] bg-[#f0fdf9] p-5">
      <h3 className="text-lg font-bold text-[#263747]">{title}</h3>
      <p className="mt-1 text-sm font-semibold text-[#64748b]">Review the information above in read-only mode, then record your decision.</p>
      <div className="mt-4"><Field label="DSDO review notes"><textarea className={`${inputClass} min-h-[110px] bg-white py-3`} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Record approval comments or explain the revisions required" /></Field></div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button disabled={reviewing} className="rounded-md border border-[#d59b35] bg-white px-4 py-2 font-semibold text-[#8a5a12] disabled:opacity-50" onClick={onReturn}>Return for Revision</button>
        <button disabled={reviewing} className="rounded-md bg-[#008c7a] px-5 py-2 font-semibold text-white disabled:opacity-50" onClick={onApprove}>{reviewing ? "Recording..." : approveLabel}</button>
      </div>
    </section>
  )
}

function SectionCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <section className="min-w-0 overflow-hidden rounded-md border border-[#d8dee8] bg-white p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold text-[#263747]">{title}</h3>{action}</div>{children}</section>
}

function InlineFieldError({ message }: { message?: string }) {
  if (!message) return null

  return (
    <p role="alert" className="mt-1.5 text-xs font-semibold text-[#b42318]">
      {message}
    </p>
  )
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

function AllocatedCaseDetails({ row }: { row: DistrictHeadCaseRow }) {
  return <CapturedCaseReadOnly row={row} showOverviewTiles={false} />
}

function UpdateRequestQueue({ user, onReviewed }: { user: ApiUser; onReviewed?: () => Promise<void> }) {
  const [requests, setRequests] = useState<IntakeUpdateRequest[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [notes, setNotes] = useState("")
  const [message, setMessage] = useState("")
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState("")
  const [approvedRequest, setApprovedRequest] = useState<IntakeUpdateRequest | null>(null)
  const selected = requests.find((item) => item.id === selectedId)
  const reviewOpen = Boolean(selectedId && selected)

  async function loadRequests() {
    const data = await apiGet<IntakeUpdateRequest[]>("/update-requests/")
    setRequests(data)
  }

  useEffect(() => {
    void loadRequests()
  }, [])

  async function review(decision: "approve" | "reject") {
    if (!selected || reviewing) return
    setReviewing(true)
    setReviewError("")
    try {
      const updated = await apiPost<IntakeUpdateRequest>(`/update-requests/${selected.id}/review/`, { decision, review_notes: notes })
      setRequests((items) => items.map((item) => item.id === updated.id ? updated : item))
      setNotes("")
      if (decision === "approve") {
        setSelectedId(null)
        setMessage("")
        setApprovedRequest(updated)
      } else {
        setMessage(`Update request for ${updated.caseReference} rejected.`)
      }
      try {
        await onReviewed?.()
      } catch {
        // The review itself succeeded; a secondary dashboard refresh must not hide that result.
      }
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "The change request could not be reviewed. Please try again.")
    } finally {
      setReviewing(false)
    }
  }

  function closeReviewModal() {
    setSelectedId(null)
    setNotes("")
    setMessage("")
    setReviewError("")
  }

  return (
    <div>
      <Panel title="Change Requests" icon={History} action={`${requests.filter((item) => item.status === "Pending").length} pending`}>
        <div className="overflow-x-auto rounded-md border border-[#d8dee8] bg-white">
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Case", "Tab", "Fields", "Requested By", "Requested At", "Status"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
            <tbody>
              {requests.length ? requests.map((request) => (
                <tr key={request.id} className="cursor-pointer bg-white hover:bg-[#f8fafc]" onClick={() => setSelectedId(request.id)}>
                  <td className="border-b border-[#edf0f4] px-3 py-3">
                    <button className="font-bold text-[#30528c] underline-offset-2 hover:text-[#008c7a] hover:underline" onClick={(event) => { event.stopPropagation(); setSelectedId(request.id) }}>{request.caseReference}</button>
                  </td>
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
      {reviewOpen && selected && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-md border border-[#d8dee8] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-[#d8dee8] bg-[#f8fafc] px-5 py-4">
              <div>
                <div className="text-xs font-bold uppercase text-[#64748b]">{user.profile.roleLabel}</div>
                <h3 className="mt-1 text-xl font-bold text-[#263747]">Change Review Panel</h3>
                <div className="mt-1 text-sm font-semibold text-[#64748b]">Request #{selected.id} | {selected.caseReference} | {selected.tab}</div>
              </div>
              <button className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]" onClick={closeReviewModal} aria-label="Close change review">x</button>
            </div>
            <div className="max-h-[calc(90vh-170px)] overflow-y-auto p-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Info label="Case" value={selected.caseReference} />
                <Info label="Section requested" value={selected.tab} />
                <Info label="Requested by" value={`${selected.requestedByName}${selected.requestedByUsername ? ` (${selected.requestedByUsername})` : ""}${selected.requestedByRole ? ` | ${selected.requestedByRole}` : ""}`} />
                <Info label="Requested at" value={formatWorkflowDateTime(selected.requested_at)} />
              </div>
              <div className="mt-4 overflow-hidden rounded-md border border-[#d8dee8] bg-white">
                <div className="flex items-center justify-between border-b border-[#d8dee8] bg-[#f8fafc] px-3 py-3">
                  <h4 className="font-bold text-[#263747]">Requested changes</h4>
                  <span className="rounded-full bg-[#e7f6f3] px-3 py-1 text-xs font-bold text-[#007464]">{selected.requested_fields.length} {selected.requested_fields.length === 1 ? "field" : "fields"}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[780px] border-collapse text-left text-sm">
                    <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Field", "Previous Value", "Requested Value"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
                    <tbody>
                      {selected.requested_fields.map((field) => (
                        <tr key={field.path}>
                          <td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]">{field.label}</td>
                          <td className="border-b border-[#edf0f4] px-3 py-3 text-[#64748b]">{field.old_value || field.current_value || "Not captured"}</td>
                          <td className="border-b border-[#edf0f4] px-3 py-3 font-semibold text-[#007464]">{field.new_value || field.proposed_value || "No value supplied"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="mt-4"><Info label="Reason for change" value={selected.reason} /></div>
              {selected.status !== "Pending" && (
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <Info label="Decision" value={selected.status} />
                  <Info label="Reviewed by" value={`${selected.reviewedByName || "Not recorded"}${selected.reviewedByUsername ? ` (${selected.reviewedByUsername})` : ""}${selected.reviewedByRole ? ` | ${selected.reviewedByRole}` : ""}`} />
                  <Info label="Reviewed at" value={selected.reviewed_at ? formatWorkflowDateTime(selected.reviewed_at) : "Not recorded"} />
                </div>
              )}
              <div className="mt-4"><Field label="Review notes"><textarea className={`${inputClass} min-h-[110px] py-3`} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field></div>
              {message && <div className="mt-4 rounded-md border border-[#b7e4d8] bg-[#f0fdf9] p-3 text-sm font-semibold text-[#007464]">{message}</div>}
              {reviewError && <div role="alert" className="mt-4 rounded-md border border-[#f2b8b5] bg-[#fff5f5] p-3 text-sm font-semibold text-[#b42318]">{reviewError}</div>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d8dee8] bg-[#f8fafc] px-5 py-4">
              <div className="text-sm text-[#64748b]">
                {selected.status === "Pending"
                  ? <>Decision will be recorded under <strong className="text-[#263747]">{userDisplayName(user)}</strong> ({user.profile.roleLabel}).</>
                  : <>Reviewed by <strong className="text-[#263747]">{selected.reviewedByName || "Not recorded"}</strong>{selected.reviewed_at ? ` on ${formatWorkflowDateTime(selected.reviewed_at)}` : ""}.</>}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747]" onClick={closeReviewModal}>Close</button>
              <button className="rounded-md border border-[#d8dee8] bg-white px-4 py-2 font-semibold text-[#263747] disabled:opacity-50" disabled={selected.status !== "Pending" || reviewing} onClick={() => review("reject")}>Reject Request</button>
              <button className="rounded-md bg-[#008c7a] px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={selected.status !== "Pending" || reviewing} onClick={() => review("approve")}>{reviewing ? "Approving..." : "Approve Changes"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {approvedRequest && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-[#102033]/55 p-4" role="dialog" aria-modal="true" aria-labelledby="change-approved-title">
          <div className="w-full max-w-xl overflow-hidden rounded-lg border border-[#b7e4d8] bg-white shadow-2xl">
            <div className="px-6 pb-4 pt-6 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#e7f6f3] text-[#008c7a]"><CheckCircle2 size={32} /></div>
              <h3 id="change-approved-title" className="mt-4 text-xl font-bold text-[#263747]">Change successfully approved</h3>
              <p className="mt-2 text-sm text-[#64748b]">The requested information has been applied to {approvedRequest.caseReference}.</p>
            </div>
            <div className="mx-6 rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Info label="Requested by" value={`${approvedRequest.requestedByName}${approvedRequest.requestedByUsername ? ` (${approvedRequest.requestedByUsername})` : ""}`} />
                <Info label="Section changed" value={approvedRequest.tab} />
              </div>
              <div className="mt-4 border-t border-[#d8dee8] pt-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[#64748b]">Approved change</div>
                <div className="space-y-2">
                  {approvedRequest.requested_fields.map((field) => (
                    <div key={field.path} className="rounded-md bg-white px-3 py-2 text-sm">
                      <span className="font-bold text-[#263747]">{field.label}:</span>{" "}
                      <span className="text-[#007464]">{field.new_value || field.proposed_value || "No value supplied"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-center border-t border-[#d8dee8] bg-[#f8fafc] px-6 py-4">
              <button autoFocus className="min-w-28 rounded-md bg-[#008c7a] px-6 py-2.5 font-semibold text-white hover:bg-[#007464]" onClick={() => setApprovedRequest(null)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const pendingClosureApprovalStatuses = ["Requested", "Submitted", "Pending Supervisor Review", "Pending Closure Approval"]

function CaseApprovalQueue({ type, cases, user, onOpenCase, onReviewed }: {
  type: "assessment-care-plan" | "closure"
  cases: CaseRecord[]
  user: ApiUser
  onOpenCase: (caseRecord: CaseRecord) => void
  onReviewed: () => Promise<void>
}) {
  const [selected, setSelected] = useState<CaseRecord | null>(null)
  const [reviewingCase, setReviewingCase] = useState<CaseRecord | null>(null)
  const [notes, setNotes] = useState("")
  const [reviewing, setReviewing] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const districtCases = cases.filter((caseRecord) => !isEmptyManualPlaceholder(caseRecord) && (!user.profile.districtName || caseRecord.district === user.profile.districtName))
  const requests = districtCases.filter((caseRecord) => type === "assessment-care-plan"
    ? ["Submitted", "Assessment Approved"].includes(caseRecord.assessmentCarePlanStatus || "")
    : pendingClosureApprovalStatuses.includes(caseRecord.closureStatus || ""))
  const title = type === "assessment-care-plan" ? "Assessment & Care Plan Approvals" : "Case Closure Approvals"
  const statusFor = (caseRecord: CaseRecord) => type === "assessment-care-plan" ? caseRecord.assessmentCarePlanStatus || "Submitted" : caseRecord.closureStatus || "Requested"
  const selectedClosureDraft = objectValue(selected?.intakeDraft?.closure_draft)
  const selectedClosureReasons = Array.isArray(selectedClosureDraft.reasons) ? selectedClosureDraft.reasons.map(String).filter(Boolean).join(", ") : "Not recorded"

  async function review(decision: string) {
    if (!selected?.backendIntakeId || reviewing) return
    if (["reject", "return"].includes(decision) && !notes.trim()) {
      setError(`Please provide a reason before you ${decision === "reject" ? "reject" : "return"} this closure request.`)
      return
    }
    setReviewing(true)
    setError("")
    try {
      const endpoint = type === "assessment-care-plan" ? "review-assessment-care-plan" : "review-closure"
      await apiPost(`/intakes/${selected.backendIntakeId}/${endpoint}/`, { decision, notes: notes.trim() })
      setMessage(`${selected.id} has been reviewed successfully.`)
      setSelected(null)
      setNotes("")
      await onReviewed()
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "The approval could not be recorded.")
    } finally {
      setReviewing(false)
    }
  }

  if (reviewingCase) {
    return <AllocatedCaseWorkspace row={{ ...reviewingCase, deadline: "", deadlineStatus: "" }} canManage={false} onBack={() => setReviewingCase(null)} backLabel="Back to approval review" />
  }

  return (
    <div>
      <Panel title={title} icon={ClipboardCheck} action={`${requests.length} pending`}>
        {message && <div className="mb-4 rounded-md border border-[#b7e4d8] bg-[#f0fdf9] px-4 py-3 text-sm font-semibold text-[#007464]">{message}</div>}
        <div className="mb-4 text-sm text-[#64748b]">Review submissions from case officers in {user.profile.districtName || "your district"}.</div>
        <div className="overflow-x-auto rounded-md border border-[#d8dee8] bg-white">
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Case Number", "Child", "District", "Assigned Officer", "Submitted", "Status", "Action"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-2.5">{head}</th>)}</tr></thead>
            <tbody>
              {requests.length ? requests.map((caseRecord) => (
                <tr key={caseRecord.id} className="bg-white hover:bg-[#f8fafc]">
                  <td className="border-b border-[#edf0f4] px-3 py-2.5"><button className="font-bold text-[#30528c] hover:text-[#008c7a] hover:underline" onClick={() => { setSelected(caseRecord); setNotes(""); setError("") }}>{caseRecord.id}</button></td>
                  <td className="border-b border-[#edf0f4] px-3 py-2.5">{caseRecord.childName}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-2.5">{caseRecord.district}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-2.5">{caseRecord.allocatedOfficer || "-"}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-2.5">{formatWorkflowDateTime(type === "assessment-care-plan" ? caseRecord.assessmentCarePlanSubmittedAt || caseRecord.updatedAt || caseRecord.createdAt : caseRecord.updatedAt || caseRecord.createdAt)}</td>
                  <td className="border-b border-[#edf0f4] px-3 py-2.5"><StatusPill label={statusFor(caseRecord)} tone="warning" /></td>
                  <td className="border-b border-[#edf0f4] px-3 py-2.5">
                    <button
                      className="grid h-9 w-9 place-items-center rounded-full border border-[#cbd5e1] bg-white text-[#008c7a] shadow-sm transition hover:border-[#008c7a] hover:bg-[#e7f6f3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#008c7a]/30"
                      onClick={() => { setSelected(caseRecord); setNotes(""); setError("") }}
                      aria-label={`Review ${type === "closure" ? "closure request" : "assessment and care plan"} for ${caseRecord.id}`}
                      title="Open approval details"
                    >
                      <InfoIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={7}>No {title.toLowerCase()} are waiting for review.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      {selected && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <div className="w-full max-w-2xl rounded-md border border-[#d8dee8] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-[#d8dee8] bg-[#f8fafc] px-5 py-4">
              <div><h3 className="text-xl font-bold text-[#263747]">{type === "closure" ? "Review Case Closure" : "Review Assessment & Care Plan"}</h3><div className="mt-1 text-sm font-semibold text-[#64748b]">{selected.id} | {selected.childName} | {statusFor(selected)}</div></div>
              <button className="rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm font-semibold text-[#263747]" onClick={() => setSelected(null)}>Close</button>
            </div>
            <div className="p-5">
              {error && <ErrorBanner message={error} />}
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <Info label="Child" value={selected.childName} />
                <Info label="Case category" value={selected.concern || "Not recorded"} />
                <Info label="Risk level" value={selected.riskLevel || "Not recorded"} />
                <Info label="Assigned officer" value={selected.allocatedOfficer || "Not recorded"} />
                <Info label="District" value={selected.district} />
                <Info label="Request status" value={statusFor(selected)} />
              </div>
              {type === "closure" && (
                <div className="mb-4 rounded-md border border-[#d8dee8] bg-[#f8fafc] p-4">
                  <div className="text-xs font-bold uppercase tracking-wide text-[#64748b]">Closure request information</div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Info label="Reason for closure" value={selectedClosureReasons} />
                    <Info label="Recommended by" value={textValue(selectedClosureDraft.recommendedBy) || selected.allocatedOfficer || "Not recorded"} />
                    <div className="sm:col-span-2"><Info label="Current situation / recommendation" value={textValue(selectedClosureDraft.currentSituation) || textValue(selectedClosureDraft.closureSummary) || "Not recorded"} /></div>
                  </div>
                </div>
              )}
              <Field label={type === "closure" ? "Decision comments / reason for rejection or return" : "Review notes"}><textarea className={`${inputClass} min-h-[120px] py-3`} value={notes} onChange={(event) => { setNotes(event.target.value); if (error) setError("") }} placeholder={type === "closure" ? "A reason is required when rejecting or returning the closure request" : "Record comments or reasons for the decision"} /></Field>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button className="mr-auto rounded-md border border-[#008c7a] bg-white px-4 py-2 font-semibold text-[#007464] hover:bg-[#e7f6f3]" onClick={() => setReviewingCase(selected)}>Review full case file</button>
                {type === "assessment-care-plan" ? <>
                  <button disabled={reviewing} className="rounded-md border border-[#d59b35] bg-white px-4 py-2 font-semibold text-[#8a5a12] disabled:opacity-50" onClick={() => void review("request_revision")}>Request revision</button>
                  <button disabled={reviewing} className="rounded-md border border-[#008c7a] bg-white px-4 py-2 font-semibold text-[#007464] disabled:opacity-50" onClick={() => void review("approve_with_comments")}>Approve with comments</button>
                  <button disabled={reviewing} className="rounded-md bg-[#008c7a] px-4 py-2 font-semibold text-white disabled:opacity-50" onClick={() => void review("approve")}>Approve</button>
                </> : <>
                  <button disabled={reviewing} className="rounded-md border border-[#b42318] bg-white px-4 py-2 font-semibold text-[#b42318] disabled:opacity-50" onClick={() => void review("reject")}>Reject closure</button>
                  <button disabled={reviewing} className="rounded-md border border-[#d59b35] bg-white px-4 py-2 font-semibold text-[#8a5a12] disabled:opacity-50" onClick={() => void review("return")}>Return case</button>
                  <button disabled={reviewing} className="rounded-md bg-[#008c7a] px-4 py-2 font-semibold text-white disabled:opacity-50" onClick={() => void review("approve")}>Approve closure</button>
                </>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DistrictHeadDashboard({ user, users, alerts, cases, calendarTasks, setSelectedAlertId, setSelectedCaseId, setView, onRefresh, lastUpdatedAt }: { user: ApiUser; users: ApiUser[]; alerts: AlertRecord[]; cases: CaseRecord[]; calendarTasks: CalendarTask[]; setSelectedAlertId: (id: string) => void; setSelectedCaseId: (id: string) => void; setView: (view: string) => void; onRefresh: () => Promise<void>; lastUpdatedAt: string | null }) {
  const [updateRequests, setUpdateRequests] = useState<IntakeUpdateRequest[]>([])
  const [updateRequestsError, setUpdateRequestsError] = useState("")
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const next7End = todayStart + 7 * 24 * 60 * 60 * 1000
  const districtAlerts = alerts.filter((alert) => !user.profile.districtName || alert.district === user.profile.districtName)
  const districtCases = cases.filter((caseRecord) => !isEmptyManualPlaceholder(caseRecord) && (!user.profile.districtName || caseRecord.district === user.profile.districtName))
  const allocationQueue = districtCases.filter((caseRecord) => ["Pending Supervisor Review", "Approved for Allocation"].includes(caseRecord.status))
  const closureRequests = districtCases.filter((caseRecord) => pendingClosureApprovalStatuses.includes(caseRecord.closureStatus || ""))
  const assessmentCarePlanApprovals = districtCases.filter((caseRecord) => ["Submitted", "Assessment Approved"].includes(caseRecord.assessmentCarePlanStatus || ""))
  const pendingUpdateRequests = updateRequests.filter((request) => request.status === "Pending")
  const highRiskCases = districtCases.filter((caseRecord) => ["HIGH", "CRITICAL"].includes(caseRecord.riskLevel.toUpperCase()))
  const criticalRiskCases = districtCases.filter((caseRecord) => caseRecord.riskLevel.toUpperCase() === "CRITICAL")
  const activeEmergencyAlerts = districtAlerts.filter((alert) => alert.emergency && !["Converted to Case", "Closed - No Further Action", "Closed - Invalid", "Rejected"].includes(alert.internalStatus))
  const activeEmergencyCases = districtCases.filter((caseRecord) => isEmergencyCaseRecord(caseRecord) && !["Allocated"].includes(caseRecord.status))
  const activeImmediateDangerCases = districtCases.filter((caseRecord) => isImmediateDangerCaseRecord(caseRecord) && !["Allocated"].includes(caseRecord.status))
  const activeImmediateDangerAlerts = districtAlerts.filter((alert) => Boolean(alert.is_immediate_danger) && !["Converted to Case", "Closed - No Further Action", "Closed - Invalid", "Rejected"].includes(alert.internalStatus))
  const emergencyCaseCount = activeEmergencyCases.length + activeEmergencyAlerts.length
  const immediateDangerCount = activeImmediateDangerCases.length + activeImmediateDangerAlerts.length
  const overdueAssessments = districtCases.filter((caseRecord) => caseRecord.assessmentSlaStatus === "Overdue" || (caseRecord.assessmentDueAt && new Date(caseRecord.assessmentDueAt).getTime() < Date.now() && !caseRecord.assessmentCompletedAt))
  const carePlanOverdue = districtCases.filter((caseRecord) => {
    const completedAt = caseRecord.assessmentCompletedAt
    const carePlanStatus = caseRecord.assessmentCarePlanStatus || ""
    const completed = ["Submitted", "Approved", "Approved with Comments"].includes(carePlanStatus)
    return Boolean(completedAt) && !completed && Date.now() - new Date(completedAt || "").getTime() > 7 * 24 * 60 * 60 * 1000
  })
  const monitoringOverdue = districtCases.filter((caseRecord) => {
    const records = caseRecord.intakeDraft?.monitoring_followups_draft
    if (!Array.isArray(records)) return false
    return records.some((record) => {
      const followUpDate = textValue((record as Record<string, unknown>).nextFollowUpDate) || textValue((record as Record<string, unknown>).next_follow_up_date)
      return Boolean(followUpDate) && new Date(followUpDate).getTime() < Date.now()
    })
  })
  const casesRequiringAttention = [...activeEmergencyCases, ...activeImmediateDangerCases, ...highRiskCases, ...overdueAssessments, ...carePlanOverdue, ...monitoringOverdue]
    .filter((caseRecord, index, list) => list.findIndex((item) => item.id === caseRecord.id) === index)
  const upcomingDeadlines = [
    ...districtCases.flatMap((caseRecord) => [
      caseRecord.assessmentDueAt ? { date: caseRecord.assessmentDueAt, title: "Assessment due", detail: `${caseRecord.id} | ${caseRecord.childName}`, urgent: ["HIGH", "CRITICAL"].includes(caseRecord.riskLevel.toUpperCase()) } : null,
      caseRecord.caseReviewDueAt ? { date: caseRecord.caseReviewDueAt, title: "Case review due", detail: `${caseRecord.id} | ${caseRecord.allocatedOfficer || "Unassigned"}`, urgent: false } : null,
    ]).filter(Boolean) as Array<{ date: string; title: string; detail: string; urgent: boolean }>,
    ...calendarTasks.map((task) => ({ date: task.date, title: task.title, detail: task.detail, urgent: task.urgent })),
  ].filter((item) => {
    const time = new Date(item.date).getTime()
    return Number.isFinite(time) && time >= todayStart && time <= next7End
  }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 4)
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
  const recentActivity = [
    ...districtAlerts.filter((alert) => alert.emergency).map((alert) => ({ date: alert.submittedAt, title: "Emergency case submitted", detail: `${alert.id} | ${alert.childName}`, tone: "danger" })),
    ...districtCases.filter((caseRecord) => Boolean(caseRecord.allocatedAt)).map((caseRecord) => ({ date: caseRecord.allocatedAt || "", title: "Case allocated to SDO", detail: `${caseRecord.id} | ${caseRecord.allocatedOfficer || "Officer not recorded"}`, tone: "review" })),
    ...districtCases.filter((caseRecord) => Boolean(caseRecord.assessmentCompletedAt)).map((caseRecord) => ({ date: caseRecord.assessmentCompletedAt || "", title: "Assessment completed", detail: `${caseRecord.id} | ${caseRecord.childName}`, tone: "review" })),
    ...districtCases.filter((caseRecord) => ["Approved", "Closed"].includes(caseRecord.closureStatus || "")).map((caseRecord) => ({ date: caseRecord.createdAt, title: "Case closed", detail: `${caseRecord.id} | ${caseRecord.childName}`, tone: "review" })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 6)
  const activityTime = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value || "-"
    const daysApart = Math.floor((todayStart - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000)
    const day = daysApart === 0 ? "Today" : daysApart === 1 ? "Yesterday" : date.toLocaleDateString([], { month: "short", day: "numeric" })
    return `${day} | ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
  }

  async function loadUpdateRequests() {
    try {
      setUpdateRequests(await apiGet<IntakeUpdateRequest[]>("/update-requests/"))
      setUpdateRequestsError("")
    } catch (error) {
      setUpdateRequests([])
      setUpdateRequestsError(error instanceof Error ? error.message : "Could not load change requests from API.")
    }
  }

  useEffect(() => {
    if (!lastUpdatedAt) return
    void loadUpdateRequests()
  }, [lastUpdatedAt])

  useEffect(() => {
    const timer = window.setInterval(() => void onRefresh(), 15_000)
    return () => window.clearInterval(timer)
  }, [onRefresh])

  function openQueue(viewName: string) {
    setView(viewName)
  }

  function openCase(caseRecord: CaseRecord) {
    if (caseRecord.sourceAlertId) setSelectedAlertId(caseRecord.sourceAlertId)
    setSelectedCaseId(caseRecord.id)
    setView(["Pending Supervisor Review", "Approved for Allocation"].includes(caseRecord.status) ? "allocation" : "allocated-cases")
  }

  return (
    <div className="space-y-5 text-[#263747]">
      {updateRequestsError && <div className="rounded-md border border-[#f4b4ac] bg-[#fff7f5] p-3 text-sm font-semibold text-[#b42318]">Some dashboard data could not be loaded: {updateRequestsError}</div>}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DecisionCard icon={ClipboardCheck} label="Pending Closure Approvals" value={closureRequests.length} summary="Awaiting approval" action="Review requests" onClick={() => openQueue("closure-approvals")} tone="purple" />
        <DecisionCard icon={UserCheck} label="Allocation Queue" value={allocationQueue.length} summary="Ready for allocation" action="Allocate cases" onClick={() => openQueue("allocation")} tone="amber" />
        <DecisionCard icon={CheckSquare} label="Assessment & Care Plan" value={assessmentCarePlanApprovals.length} summary="Awaiting approval" action="Review submissions" onClick={() => openQueue("assessment-care-plan-approvals")} tone="teal" />
        <DecisionCard icon={FileText} label="Change Approvals" value={pendingUpdateRequests.length} summary="Pending changes" action="Review requests" onClick={() => openQueue("update-requests")} tone="blue" />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <DashboardSection title="My Action Queue" icon={ClipboardCheck}>
          <div className="divide-y divide-[#edf0f4]">
            {[
              { label: "Allocate submitted cases", value: allocationQueue.length, view: "allocation" },
              { label: "Review cases requiring attention", value: casesRequiringAttention.length, view: "attention" },
              { label: "Approve change requests", value: pendingUpdateRequests.length, view: "update-requests" },
              { label: "Review closure requests", value: closureRequests.length, view: "closure-approvals" },
            ].map((item) => <ActionQueueRow key={item.label} label={item.label} value={item.value} onClick={() => openQueue(item.view)} />)}
          </div>
        </DashboardSection>

        <DashboardSection title="Child Protection Alerts" icon={ShieldAlert}>
          {emergencyCaseCount || immediateDangerCount || criticalRiskCases.length || monitoringOverdue.filter((caseRecord) => ["HIGH", "CRITICAL"].includes(caseRecord.riskLevel.toUpperCase())).length ? <div className="grid gap-3 sm:grid-cols-2"><RiskTile label="Emergency cases" value={emergencyCaseCount} tone="danger" /><RiskTile label="Immediate danger" value={immediateDangerCount} tone="danger" /><RiskTile label="Critical risk" value={criticalRiskCases.length} tone="danger" /><RiskTile label="Overdue high-risk follow-ups" value={monitoringOverdue.filter((caseRecord) => ["HIGH", "CRITICAL"].includes(caseRecord.riskLevel.toUpperCase())).length} tone="warning" /></div> : <div className="flex min-h-48 flex-col items-center justify-center rounded-md border border-[#b7e4d8] bg-[#f0fdf9] p-6 text-center"><Shield className="h-12 w-12 text-[#008c7a]" /><div className="mt-3 text-lg font-bold text-[#007464]">No Child Protection Alerts</div><div className="mt-1 max-w-xs text-sm font-semibold text-[#50617a]">No emergency or high-risk cases require immediate district intervention.</div></div>}
        </DashboardSection>

        <DashboardSection title="Workflow Exceptions" icon={Clock3}>
          <div className="grid gap-2 sm:grid-cols-2">
            {[{ label: "Assessment overdue", value: overdueAssessments.length }, { label: "Care plan overdue", value: carePlanOverdue.length }, { label: "Monitoring overdue", value: monitoringOverdue.length }, { label: "Unallocated cases", value: allocationQueue.length }].map((item) => <div key={item.label} className="rounded-md border border-[#edf0f4] bg-[#f8fafc] p-3"><div className="font-bold text-[#50617a]">{item.label}</div><div className={`mt-2 text-4xl font-bold leading-none ${item.value ? "text-[#a05b16]" : "text-[#007464]"}`}>{item.value}</div></div>)}
          </div>
        </DashboardSection>

        <DashboardSection title="District Workload" icon={Users}>
            <div className="space-y-2">
              {allocationLoad.length ? allocationLoad.map((officer) => (
                <div key={officer.key} className="rounded-md border border-[#edf0f4] bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-bold text-[#263747]">{officer.name}</div>
                      <div className="text-xs font-semibold text-[#64748b]">{officer.count} active case{officer.count === 1 ? "" : "s"}</div>
                    </div>
                    {officer.critical > 0 && <span className="rounded-full bg-[#fee4e2] px-3 py-1 text-xs font-bold text-[#b42318]">{officer.critical} critical</span>}
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e2e8f0]">
                    <div className={`h-full ${officer.tone === "Heavy" ? "bg-[#b42318]" : "bg-[#008c7a]"}`} style={{ width: `${Math.min(100, officer.count * 12)}%` }} />
                  </div>
                </div>
              )) : <div className="rounded-md border border-dashed border-[#d8dee8] bg-[#f8fafc] p-6 text-center"><Users className="mx-auto h-9 w-9 text-[#94a3b8]" /><div className="mt-3 font-bold text-[#50617a]">No officers have been assigned to this district yet.</div><div className="mt-1 text-sm font-semibold text-[#64748b]">Register officers to begin workload monitoring.</div></div>}
            </div>
        </DashboardSection>

        <DashboardSection title="Recent Activity" icon={History}>
            <div className="max-h-[580px] space-y-2 overflow-y-auto pr-1">
              {recentActivity.map((item) => (
                <div key={`${item.title}-${item.detail}-${item.date}`} className="flex gap-3 rounded-md border border-[#edf0f4] bg-[#f8fafc] p-3">
                  <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.tone === "danger" ? "bg-[#b42318]" : "bg-[#008c7a]"}`} />
                  <div className="flex items-center justify-between gap-2">
                    <div><div className="font-bold text-[#263747]">{item.title}</div>
                    <div className="mt-1 text-sm font-semibold text-[#64748b]">{item.detail}</div></div>
                    <span className="shrink-0 text-xs font-semibold text-[#64748b]">{activityTime(item.date)}</span>
                  </div>
                </div>
              ))}
              {!recentActivity.length && <EmptyState text="No recent district activity yet." />}
            </div>
        </DashboardSection>

        <DashboardSection title="Upcoming Deadlines" icon={CalendarDays}>
          <div className="max-h-[580px] space-y-2 overflow-y-auto pr-1">
            {upcomingDeadlines.length ? upcomingDeadlines.map((item) => <div key={`${item.title}-${item.detail}-${item.date}`} className="flex gap-3 rounded-md border border-[#edf0f4] bg-[#f8fafc] p-3"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md text-white ${item.urgent ? "bg-[#b42318]" : "bg-[#008c7a]"}`}><CalendarDays className="h-5 w-5" /></span><div className="min-w-0"><div className="font-bold text-[#263747]">{item.title}</div><div className="mt-1 text-sm font-semibold text-[#64748b]">{item.detail}</div><div className="mt-1 text-xs font-bold text-[#50617a]">{formatWorkflowDateTime(item.date)}</div></div></div>) : <div className="rounded-md border border-dashed border-[#d8dee8] bg-[#f8fafc] p-6 text-center text-sm font-semibold text-[#64748b]">No district deadlines in the next 7 days.</div>}
          </div>
        </DashboardSection>
      </section>
    </div>
  )
}

function DecisionCard({ icon: Icon, label, value, summary, action, tone, onClick }: { icon: ElementType; label: string; value: number; summary: string; action: string; tone: "purple" | "amber" | "red" | "blue" | "teal"; onClick: () => void }) {
  const styles = {
    purple: { bar: "bg-[#7c4d9e]", icon: "bg-[#f4ecf8] text-[#7c4d9e]", value: "text-[#684087]" },
    amber: { bar: "bg-[#d27a0d]", icon: "bg-[#fff4df] text-[#a85f08]", value: "text-[#9a5709]" },
    red: { bar: "bg-[#c52b24]", icon: "bg-[#fff0ef] text-[#b42318]", value: "text-[#b42318]" },
    blue: { bar: "bg-[#2e6fa3]", icon: "bg-[#eaf4fb] text-[#2e6fa3]", value: "text-[#245f8d]" },
    teal: { bar: "bg-[#008c7a]", icon: "bg-[#e7f6f3] text-[#008c7a]", value: "text-[#007464]" },
  }[tone]
  return (
    <button type="button" className="group relative flex min-h-[132px] flex-col overflow-hidden rounded-xl border border-[#d7e0ea] bg-white p-4 text-left shadow-[0_2px_8px_rgba(38,55,71,0.06)] transition hover:border-[#aabaca] hover:shadow-[0_5px_14px_rgba(38,55,71,0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#008c7a]/35" onClick={onClick}>
      <span className="flex items-start justify-between gap-3 pl-1">
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-extrabold uppercase tracking-[0.05em] text-[#64748b]">{label}</span>
          <span className={`mt-2 block text-[32px] font-extrabold leading-none tracking-tight ${styles.value}`}>{value}</span>
          <span className="mt-1.5 block truncate text-xs font-semibold text-[#64748b]">{summary}</span>
        </span>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${styles.icon}`}><Icon className="h-5 w-5" /></span>
      </span>
      <span className="mt-auto flex items-center gap-1.5 pl-1 pt-2 text-xs font-extrabold text-[#007d6d]">
        <span>{action}</span><ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  )
}

function ActionQueueRow({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  const active = value > 0
  return (
    <button type="button" className={`flex min-h-[52px] w-full items-center gap-3 px-2 text-left transition first:rounded-t-md last:rounded-b-md ${active ? "bg-[#f7fbfa] hover:bg-[#eef8f5]" : "hover:bg-[#f8fafc]"}`} onClick={onClick}>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${active ? "bg-[#008c7a]" : "border border-[#aab7c6] bg-white"}`} />
      <span className={`min-w-0 flex-1 truncate text-sm ${active ? "font-extrabold text-[#263747]" : "font-semibold text-[#64748b]"}`}>{label}</span>
      <span className={`min-w-7 text-right text-lg font-extrabold leading-none ${active ? "text-[#263747]" : "text-[#94a3b8]"}`}>{value}</span>
      <ArrowRight className={`h-4 w-4 shrink-0 ${active ? "text-[#008c7a]" : "text-[#aab7c6]"}`} />
    </button>
  )
}

function DashboardSection({ title, icon: Icon, children }: { title: string; icon: ElementType; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-md border border-[#d8dee8] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 border-b border-[#edf0f4] pb-3">
        <Icon className="h-6 w-6 text-[#008c7a]" />
        <h2 className="text-lg font-bold text-[#263747]">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function RiskTile({ label, value, tone }: { label: string; value: number; tone: "danger" | "warning" }) {
  const active = value > 0
  return (
    <div className={`relative min-h-[88px] overflow-hidden rounded-lg border p-3.5 ${active ? tone === "danger" ? "border-[#efb8b3] bg-[#fffafa]" : "border-[#ecd197] bg-[#fffdf8]" : "border-[#e1e7ee] bg-[#fafbfd]"}`}>
      <span className={`absolute inset-y-0 left-0 w-1 ${active ? tone === "danger" ? "bg-[#c52b24]" : "bg-[#d27a0d]" : "bg-[#cbd5e1]"}`} />
      <div className="flex h-full items-start justify-between gap-3 pl-1">
        <div>
          <div className={`text-sm font-extrabold ${active ? "text-[#3f5065]" : "text-[#64748b]"}`}>{label}</div>
          <div className="mt-1.5 text-[11px] font-semibold text-[#8a97a8]">Current district total</div>
        </div>
        <div className={`text-3xl font-extrabold leading-none ${active ? tone === "danger" ? "text-[#b42318]" : "text-[#a05b16]" : "text-[#94a3b8]"}`}>{value}</div>
      </div>
    </div>
  )
}

function InternalDashboard({ user, users, alerts, cases, calendarTasks, setSelectedAlertId, setSelectedCaseId, setView, onOpenAllocatedCase, onRefresh, lastUpdatedAt }: { user: ApiUser; users: ApiUser[]; alerts: AlertRecord[]; cases: CaseRecord[]; calendarTasks: CalendarTask[]; setSelectedAlertId: (id: string) => void; setSelectedCaseId: (id: string) => void; setView: (view: string) => void; onOpenAllocatedCase: (caseRecord: CaseRecord) => void; onRefresh: () => Promise<void>; lastUpdatedAt: string | null }) {
  if (user.profile.role === "DISTRICT_HEAD") {
    return <DistrictHeadDashboard user={user} users={users} alerts={alerts} cases={cases} calendarTasks={calendarTasks} setSelectedAlertId={setSelectedAlertId} setSelectedCaseId={setSelectedCaseId} setView={setView} onRefresh={onRefresh} lastUpdatedAt={lastUpdatedAt} />
  }

  const isNationalMapUser = ["SYS_ADMIN", "DEPUTY_DIRECTOR", "DIRECTOR", "PROGRAMME_OFFICER"].includes(user.profile.role)
  const isProvincialMapUser = user.profile.role === "PROVINCIAL_HEAD"
  const isDistrictMapUser = ["DISTRICT_HEAD", "DSDO"].includes(user.profile.role)
  const mapScopeRegion = isDistrictMapUser && user.profile.districtName ? user.profile.districtName : isProvincialMapUser && user.profile.provinceName ? user.profile.provinceName : "Zimbabwe"
  const [selectedRegion, setSelectedRegion] = useState(mapScopeRegion)
  const [mapBoundaries, setMapBoundaries] = useState<{ provinces: GeoJsonCollection; districts: GeoJsonCollection }>(previewMapBoundaries)
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<number | null>(null)
  const [todoScope, setTodoScope] = useState<"all" | "month">("all")
  const currentDate = new Date()
  const [visibleMonthDate, setVisibleMonthDate] = useState(() => new Date(currentDate.getFullYear(), currentDate.getMonth(), 1))
  const today = currentDate.getDate()
  const currentYear = visibleMonthDate.getFullYear()
  const currentMonth = visibleMonthDate.getMonth()
  const monthName = visibleMonthDate.toLocaleString("default", { month: "long", year: "numeric" })
  const isViewingCurrentMonth = currentDate.getFullYear() === currentYear && currentDate.getMonth() === currentMonth
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
  const firstDayOffset = (new Date(currentYear, currentMonth, 1).getDay() + 6) % 7
  const calendarDays: (number | null)[] = [...Array(firstDayOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)]
  const districtProvinceName = (districtName: string) => String(districtFeatureByName(districtName, mapBoundaries.districts)?.properties?.adm1_name || "")
  const caseIsInMapScope = (caseRecord: CaseRecord) => {
    if (isNationalMapUser) return true
    if (isDistrictMapUser) return Boolean(user.profile.districtName && sameMapBoundaryName(caseRecord.district, user.profile.districtName))
    if (isProvincialMapUser) return Boolean(user.profile.provinceName && sameMapBoundaryName(districtProvinceName(caseRecord.district), user.profile.provinceName))
    return true
  }
  const visibleCases = cases.filter((caseRecord) => !isEmptyManualPlaceholder(caseRecord) && caseIsInMapScope(caseRecord))
  const openCases = visibleCases.filter((caseRecord) => caseRecord.status !== "Draft" && !caseIsClosed(caseRecord))
  const casePoints = openCases.map((caseRecord) => {
    const [districtLat, districtLng] = districtMapCenter(caseRecord.district, mapBoundaries.districts)
    const lat = caseRecord.captureLatitude ?? districtLat
    const lng = caseRecord.captureLongitude ?? districtLng
    return {
      ...caseRecord,
      lat,
      lng,
      priority: caseRecord.riskLevel.toUpperCase() === "CRITICAL" || isImmediateDangerCaseRecord(caseRecord) ? "Critical" : caseRecord.riskLevel.toUpperCase() === "HIGH" ? "High" : caseRecord.riskLevel.toUpperCase() === "MEDIUM" ? "Medium" : "Low",
      offset: 0,
    }
  })
  const selectedDistricts = selectedRegion === "Zimbabwe" ? [] : regionDistrictNames(selectedRegion, mapBoundaries.districts)
  const immediateActionAlerts = alerts.filter((alert) => [alert.internalStatus, alert.status].includes("Immediate Action Required"))
  const myAllocatedCases = visibleCases.filter((caseRecord) => caseRecord.status === "Allocated" && isCaseAllocatedToUser({ ...caseRecord, deadline: "", deadlineStatus: "" }, user))
  const highPriorityCases = myAllocatedCases.filter((caseRecord) => isEmergencyCaseRecord(caseRecord) || ["HIGH", "CRITICAL"].includes(caseRecord.riskLevel.toUpperCase()))
  const selectedCases = visibleCases.filter((caseRecord) => selectedRegion === "Zimbabwe" || caseRecord.district === selectedRegion || selectedDistricts.includes(caseRecord.district))
  const selectedOpenCases = openCases.filter((caseRecord) => selectedRegion === "Zimbabwe" || caseRecord.district === selectedRegion || selectedDistricts.includes(caseRecord.district))
  const monthTasks = calendarTasks.filter((task) => {
    const date = new Date(`${task.date}T00:00:00`)
    return date.getFullYear() === currentYear && date.getMonth() === currentMonth
  })
  const calendarMarkers = new Set(monthTasks.map((task) => Number(task.date.slice(8, 10))).filter(Boolean))
  const todoItems = [...calendarTasks].sort((a, b) => a.date.localeCompare(b.date)).map((task) => ({
    day: Number(task.date.slice(8, 10)),
    date: task.date,
    title: task.title,
    detail: task.detail,
    meta: task.source,
    urgent: task.urgent,
  }))
  const visibleTodos = selectedCalendarDay ? todoItems.filter((item) => item.date.slice(0, 7) === `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}` && item.day === selectedCalendarDay) : todoScope === "month" ? todoItems.filter((item) => item.date.slice(0, 7) === `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}`) : todoItems

  useEffect(() => {
    let mounted = true
    Promise.all([
      fetch("/geo/provinces.json").then((response) => response.json() as Promise<GeoJsonCollection>),
      fetch("/geo/districts.json").then((response) => response.json() as Promise<GeoJsonCollection>),
    ]).then(([provinces, districts]) => {
      if (mounted && provinces.features?.length && districts.features?.length) setMapBoundaries({ provinces, districts })
    }).catch(() => undefined)
    return () => {
      mounted = false
    }
  }, [])

  function showCalendarMonth(monthOffset: number) {
    setVisibleMonthDate((date) => new Date(date.getFullYear(), date.getMonth() + monthOffset, 1))
    setSelectedCalendarDay(null)
  }

  function toggleMonthTodoScope() {
    setTodoScope((scope) => scope === "all" ? "month" : "all")
    setSelectedCalendarDay(null)
  }

  function selectMapRegion(region: string) {
    if (isDistrictMapUser) {
      setSelectedRegion(mapScopeRegion)
      return
    }
    if (isProvincialMapUser) {
      const inUserProvince = sameMapBoundaryName(region, mapScopeRegion) || sameMapBoundaryName(districtProvinceName(region), mapScopeRegion)
      if (!inUserProvince) return
    }
    setSelectedRegion(region)
  }

  function openCase(caseRecord: DashboardCasePoint) {
    if (caseRecord.sourceAlertId) setSelectedAlertId(caseRecord.sourceAlertId)
    onOpenAllocatedCase(caseRecord)
  }

  function openTodoCase(caseReference: string, detail: string) {
    const detailCaseReference = detail.match(/[A-Z]{2,4}\/\d{4}\/[^\s|]+/)?.[0]
    const caseRecord = cases.find((item) => item.id === caseReference || item.id === detailCaseReference)
    if (!caseRecord) return
    if (caseRecord.sourceAlertId) setSelectedAlertId(caseRecord.sourceAlertId)
    onOpenAllocatedCase(caseRecord)
  }

  return (
    <div className="space-y-5 text-[#263747]">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MonitorStat icon={Inbox} label="Open Alerts" value={immediateActionAlerts.length} iconTone="bg-[#ff5058]" onClick={() => setView("case-alerts")} />
        <MonitorStat icon={ShieldAlert} label="High Priority" value={highPriorityCases.length} iconTone="bg-[#b42318]" onClick={() => setView("high-priority-cases")} />
        <MonitorStat icon={ClipboardCheck} label="Draft Cases" value={visibleCases.filter((caseRecord) => caseRecord.status === "Draft").length} iconTone="bg-[#7460bd]" onClick={() => setView("case-intake")} />
        <MonitorStat icon={UserCheck} label="Allocated" value={myAllocatedCases.length} iconTone="bg-[#20c455]" onClick={() => setView("allocated-cases")} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="h-[560px] rounded-md border border-[#d8dee8] bg-gradient-to-br from-white via-white to-[#eef8ff] p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[18px] font-bold text-[#263747]"><CalendarDays className="h-5 w-5 text-[#008c7a]" /> {monthName}</div>
              <div className="text-[13px] text-[#64748b]">{selectedCalendarDay ? `Actions scheduled for ${monthName} ${selectedCalendarDay}` : "Scheduled case actions"}</div>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-[#d8dee8] bg-white p-1 shadow-sm">
              <button className="grid h-9 w-9 place-items-center rounded-md text-[#50617a] transition hover:bg-[#eef8ff] hover:text-[#008c7a]" onClick={() => showCalendarMonth(-1)} aria-label="Previous month" title="Previous month">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button className={`h-9 rounded-md px-3 text-[13px] font-semibold transition hover:bg-[#f6f8fb] ${todoScope === "month" ? "bg-[#eef8ff] text-[#007464]" : "text-[#263747]"}`} onClick={toggleMonthTodoScope} aria-pressed={todoScope === "month"}>{todoScope === "month" ? "All tasks" : "Month"}</button>
              <button className="grid h-9 w-9 place-items-center rounded-md text-[#50617a] transition hover:bg-[#eef8ff] hover:text-[#008c7a]" onClick={() => showCalendarMonth(1)} aria-label="Next month" title="Next month">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-2 text-center text-[12px] font-semibold text-[#64748b]">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day}>{day}</div>)}
            {calendarDays.map((day, index) => (
              day ? (
                <button
                  key={day}
                  className={`relative min-h-[64px] rounded-md border text-[14px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition ${selectedCalendarDay === day && isViewingCurrentMonth && day === today ? "border-[#008c7a] bg-[#d9f1ed] text-[#007464] ring-2 ring-[#008c7a]/15" : selectedCalendarDay === day ? "border-[#2e6fa3] bg-[#eef8ff] text-[#1f4f7a] ring-2 ring-[#2e6fa3]/10" : isViewingCurrentMonth && day === today ? "border-[#008c7a] bg-[#e7f6f3] text-[#007464]" : "border-[#edf0f4] bg-white/80 text-[#263747] hover:border-[#008c7a] hover:bg-white"}`}
                  onClick={() => setSelectedCalendarDay(day)}
                >
                  {day}
                  {calendarMarkers.has(day) && <span className="absolute bottom-2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[#ff5058]" />}
                </button>
              ) : <div key={`blank-${index}`} />
            ))}
          </div>
        </div>

        <aside className="flex h-[560px] min-h-0 flex-col rounded-md border border-[#d8dee8] bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[18px] font-bold text-[#263747]"><CheckSquare className="h-5 w-5 text-[#008c7a]" /> To Do</div>
              <div className="text-[13px] text-[#64748b]">{selectedCalendarDay ? `Tasks for ${monthName} ${selectedCalendarDay}` : todoScope === "month" ? `Tasks for ${monthName}` : "Priority actions for the current desk"}</div>
            </div>
            <span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-bold text-[#263747]">{visibleTodos.length}</span>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {visibleTodos.length ? visibleTodos.map((item) => (
              <button key={`${item.meta}-${item.date}-${item.title}`} className="flex w-full cursor-pointer gap-3 rounded-md border border-[#edf0f4] bg-[#f8fafc] p-3 text-left transition hover:border-[#008c7a] hover:bg-[#e7f6f3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#008c7a]" onClick={() => openTodoCase(item.meta, item.detail)} title={`Open case ${item.meta}`}>
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
              <div className="text-[13px] text-[#64748b]">Click a region or marker to focus the open-case summary.</div>
            </div>
            <button className="inline-flex items-center gap-2 rounded-md border border-[#d8dee8] px-3 py-2 text-[13px] font-semibold text-[#263747]" onClick={() => setSelectedRegion(mapScopeRegion)}><Maximize2 className="h-4 w-4" /> Reset</button>
          </div>
          <ZimbabweLeafletMap casePoints={casePoints} selectedRegion={selectedRegion} boundaries={mapBoundaries} openCase={openCase} onSelectRegion={selectMapRegion} />
        </div>

        <aside className="flex h-[520px] min-h-0 flex-col gap-4">
          <div className="shrink-0 rounded-md border border-[#d8dee8] bg-white p-4 shadow-sm">
            <h2 className="text-[18px] font-bold text-[#263747]">{selectedRegion === "Zimbabwe" ? "Open Cases Overview" : selectedRegion}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <RegionStat label="Open Cases" value={selectedRegion === "Zimbabwe" ? openCases.length : selectedOpenCases.length} />
              <RegionStat label="High Priority" value={selectedRegion === "Zimbabwe" ? openCases.filter((row) => ["HIGH", "CRITICAL"].includes(row.riskLevel.toUpperCase())).length : selectedOpenCases.filter((row) => ["HIGH", "CRITICAL"].includes(row.riskLevel.toUpperCase())).length} />
              <RegionStat label="Priority" value={selectedOpenCases.some((row) => ["HIGH", "CRITICAL"].includes(row.riskLevel.toUpperCase())) ? "High" : "Normal"} />
              <RegionStat label="Closed Cases" value={selectedCases.filter(caseIsClosed).length} />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col rounded-md border border-[#d8dee8] bg-white shadow-sm">
            <div className="border-b border-[#d8dee8] px-4 py-3 text-[18px] font-bold text-[#263747]">Active Work</div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {casePoints.length ? casePoints.map((caseRecord) => (
                <button key={caseRecord.id} className="block w-full border-b border-[#edf0f4] px-4 py-3 text-left hover:bg-[#f8fafc]" onClick={() => openCase(caseRecord)}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-[#263747]">{caseRecord.concern}</span>
                    <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${caseRecord.priority === "High" ? "bg-[#fee4e2] text-[#b42318]" : caseRecord.priority === "Medium" ? "bg-[#fff4d6] text-[#a05b16]" : "bg-[#e7f6f3] text-[#007464]"}`}>{caseRecord.priority}</span>
                  </div>
                  <div className="mt-1 text-[13px] text-[#64748b]">{caseRecord.id} | {caseRecord.district} | {caseRecord.status}</div>
                </button>
              )) : <div className="p-5 text-sm text-[#64748b]">No open cases to map.</div>}
            </div>
          </div>
        </aside>
      </section>
    </div>
  )
}

function MonitorStat({ icon: Icon, label, value, iconTone, onClick }: { icon: ElementType; label: string; value: string | number; iconTone: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      className="flex min-h-[110px] w-full items-center gap-5 rounded-md border border-[#d8dee8] bg-white px-5 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#008c7a] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#008c7a] focus-visible:ring-offset-2"
      onClick={onClick}
      aria-label={`Open ${label}`}
    >
      <div className={`grid h-[70px] w-[70px] shrink-0 place-items-center rounded-md text-white ${iconTone}`}>
        <Icon className="h-8 w-8" />
      </div>
      <div className="min-w-0">
        <div className="text-[30px] font-bold leading-none text-[#7789a6]">{value}</div>
        <div className="mt-2 text-[14px] leading-tight text-[#30528c]">{label}</div>
      </div>
    </button>
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
  boundaries,
  openCase,
  onSelectRegion,
}: {
  casePoints: DashboardCasePoint[]
  selectedRegion: string
  boundaries: { provinces: GeoJsonCollection; districts: GeoJsonCollection }
  openCase: (caseRecord: DashboardCasePoint) => void
  onSelectRegion: (region: string) => void
}) {
  const zimbabweBounds: LatLngBoundsExpression = [[-23.2, 23.8], [-14.9, 33.9]]
  const selectedDistrict = selectedRegion === "Zimbabwe" ? undefined : districtFeatureByName(selectedRegion, boundaries.districts)
  const selectedProvince = selectedDistrict || selectedRegion === "Zimbabwe" ? undefined : provinceFeatureByName(selectedRegion, boundaries.provinces)
  const visibleDistrictFeatures = selectedDistrict
    ? [selectedDistrict]
    : selectedProvince
      ? boundaries.districts.features.filter((feature) => sameMapBoundaryName(feature.properties.adm1_name, selectedRegion))
      : boundaries.districts.features
  const visibleDistricts: GeoJsonCollection = { ...boundaries.districts, features: visibleDistrictFeatures }
  const visibleCasePoints = selectedDistrict
    ? casePoints.filter((point) => sameMapBoundaryName(point.district, selectedRegion))
    : selectedProvince
      ? casePoints.filter((point) => sameMapBoundaryName(districtFeatureByName(point.district, boundaries.districts)?.properties.adm1_name, selectedRegion))
      : casePoints
  const clusters = clusterDashboardMarkers(visibleCasePoints)
  const maxDistrictCases = Math.max(1, ...visibleDistrictFeatures.map((feature) => districtCaseCount(feature, visibleCasePoints)))
  const boundariesReady = boundaries.districts.features.length > 0
  return (
    <div className="relative h-[460px] overflow-hidden border-t border-[#d8dee8] bg-[#eef2f5] [&_.leaflet-container]:bg-[#eef2f5] [&_.leaflet-control-layers]:rounded-md [&_.leaflet-control-layers]:border-[#cfd8e6] [&_.leaflet-control-layers]:bg-white [&_.leaflet-control-layers]:text-[#263747] [&_.leaflet-interactive]:outline-none [&_.leaflet-popup-content-wrapper]:rounded-md [&_.leaflet-popup-content-wrapper]:text-[#263747]">
      <MapContainer className="h-full w-full" center={[-19.0, 29.65]} zoom={6.7} minZoom={6.4} maxZoom={10} maxBounds={zimbabweBounds} maxBoundsViscosity={1} attributionControl={false} scrollWheelZoom>
        <MapFocus selectedRegion={selectedRegion} boundaries={boundaries} />
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Clean map">
            <TileLayer opacity={0.58} attribution="&copy; CARTO &copy; OpenStreetMap" url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png" />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Light labels">
            <TileLayer opacity={0.5} attribution="&copy; CARTO &copy; OpenStreetMap" url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Street detail">
            <TileLayer opacity={0.45} attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          </LayersControl.BaseLayer>
          <LayersControl.Overlay checked name="District boundaries">
            <LayerGroup>
              <LeafletGeoJSON
                key={`district-boundaries-${selectedRegion}-${visibleCasePoints.length}`}
                data={visibleDistricts as never}
                style={(feature) => {
                  const name = String(feature?.properties?.adm2_name || "")
                  const province = String(feature?.properties?.adm1_name || "")
                  const active = sameMapBoundaryName(name, selectedRegion)
                  const inSelectedProvince = sameMapBoundaryName(province, selectedRegion)
                  const count = districtCaseCount(feature as GeoJsonFeature | undefined, visibleCasePoints)
                  return {
                    color: active ? "#004c45" : count ? "#007464" : inSelectedProvince ? "#2f817b" : "#668099",
                    fillColor: districtWorkloadColor(count, maxDistrictCases, active || inSelectedProvince),
                    fillOpacity: count ? active ? 0.3 : 0.2 : active || inSelectedProvince ? 0.14 : 0.035,
                    opacity: active || inSelectedProvince || count ? 1 : 0.5,
                    weight: active ? 2.1 : count ? 1.5 : inSelectedProvince ? 1.35 : 0.85,
                  }
                }}
                onEachFeature={(feature, layer) => {
                  const name = String(feature.properties?.adm2_name || "District")
                  const province = String(feature.properties?.adm1_name || "Province")
                  const count = districtCaseCount(feature as GeoJsonFeature, visibleCasePoints)
                  const high = visibleCasePoints.filter((point) => sameMapBoundaryName(point.district, name) && ["High", "Critical"].includes(point.priority)).length
                  layer.bindTooltip(`${name} (${count})`)
                  layer.bindPopup(`<strong>${name}</strong><br/>Province: ${province}<br/>Open cases: ${count}<br/>High priority: ${high}`)
                  layer.on({
                    click: () => onSelectRegion(name),
                    mouseover: () => {
                      if ("setStyle" in layer) (layer as { setStyle: (style: { color: string; weight: number; opacity: number }) => void }).setStyle({ color: "#005f56", weight: 2.4, opacity: 1 })
                    },
                    mouseout: () => {
                      const active = sameMapBoundaryName(name, selectedRegion)
                      const inSelectedProvince = sameMapBoundaryName(province, selectedRegion)
                      const count = districtCaseCount(feature as GeoJsonFeature, visibleCasePoints)
                      if ("setStyle" in layer) (layer as { setStyle: (style: { color: string; weight: number; opacity: number }) => void }).setStyle({ color: active ? "#004c45" : count ? "#007464" : inSelectedProvince ? "#2f817b" : "#668099", weight: active ? 2.1 : count ? 1.5 : inSelectedProvince ? 1.35 : 0.85, opacity: active || inSelectedProvince || count ? 1 : 0.5 })
                    },
                  })
                }}
              />
            </LayerGroup>
          </LayersControl.Overlay>
          <LayersControl.Overlay checked name="Open cases">
            <LayerGroup>
              {clusters.map((cluster) => cluster.items.length > 1 ? (
                <Fragment key={cluster.id}>
                  <CircleMarker center={[cluster.lat, cluster.lng]} radius={clusterRadius(cluster.items.length) + 8} pathOptions={{ className: "ncms-map-cluster-ring", color: clusterColor(cluster.items), fillColor: clusterColor(cluster.items), fillOpacity: 0.12, opacity: 0.3, weight: 1 }} />
                  <CircleMarker center={[cluster.lat, cluster.lng]} radius={clusterRadius(cluster.items.length)} pathOptions={{ className: "ncms-map-marker-pulse", color: "#ffffff", fillColor: clusterColor(cluster.items), fillOpacity: 0.92, weight: 2 }}>
                    <Tooltip permanent direction="center" className="!border-0 !bg-transparent !p-0 !text-[11px] !font-bold !text-white !shadow-none">{cluster.items.length}</Tooltip>
                    <Popup>
                      <strong>{cluster.items.length} open cases</strong>
                      <br />
                      {cluster.items.slice(0, 5).map((item) => item.id).join(", ")}
                    </Popup>
                  </CircleMarker>
                </Fragment>
              ) : (
                <DashboardMapMarker key={cluster.items[0].id} point={cluster.items[0]} openCase={openCase} />
              ))}
            </LayerGroup>
          </LayersControl.Overlay>
        </LayersControl>
      </MapContainer>
      {!boundariesReady && <div className="absolute left-4 top-4 z-[450] rounded-md border border-[#d8dee8] bg-white/95 px-3 py-2 text-xs font-bold text-[#50617a] shadow-sm">Loading Zimbabwe boundaries...</div>}
      <MapLegend />
    </div>
  )
}

function MapFocus({ selectedRegion, boundaries }: { selectedRegion: string; boundaries: { provinces: GeoJsonCollection; districts: GeoJsonCollection } }) {
  const map = useMap()
  useEffect(() => {
    const nationalBounds: LatLngBoundsExpression = [[-22.95, 24.35], [-15.15, 33.45]]
    const feature = selectedRegion === "Zimbabwe" ? null : districtFeatureByName(selectedRegion, boundaries.districts) || provinceFeatureByName(selectedRegion, boundaries.provinces)
    if (feature) {
      const bounds = geoJSON(feature as never).getBounds()
      if (bounds.isValid()) {
        map.setMaxBounds(bounds.pad(0.35))
        map.fitBounds(bounds, { padding: [38, 38], animate: true, maxZoom: 11 })
        return
      }
    }
    map.setMaxBounds(nationalBounds)
    map.fitBounds(nationalBounds, { padding: [16, 16], animate: true })
  }, [map, selectedRegion, boundaries])
  return null
}

function DashboardMapMarker({ point, openCase }: { point: DashboardCasePoint; openCase: (caseRecord: DashboardCasePoint) => void }) {
  const color = dashboardMapMarkerColor(point)
  const urgent = ["High", "Critical"].includes(point.priority)
  const markerRadius = point.priority === "Critical" ? 7 : point.priority === "High" ? 6 : 5
  return (
    <>
      <CircleMarker center={[point.lat + point.offset, point.lng + point.offset]} radius={markerRadius + 12} pathOptions={{ className: "ncms-map-cluster-ring", color, fillColor: color, fillOpacity: 0.2, opacity: 0.42, weight: 2 }} />
      <CircleMarker
        center={[point.lat + point.offset, point.lng + point.offset]}
        radius={markerRadius}
        pathOptions={{ className: `ncms-map-marker-pulse${urgent ? " ncms-map-marker-pulse-urgent" : ""}`, color: "#ffffff", fillColor: color, fillOpacity: 0.95, weight: 2.5 }}
      >
        <Popup>
          <div className="min-w-[210px] text-sm">
            <strong>{point.id}</strong>
            <div className="mt-1">{point.concern}</div>
            <div className="mt-2 text-xs text-[#64748b]">{point.district} | {point.status} | {point.priority}</div>
            <button className="mt-3 rounded-md bg-[#007464] px-3 py-1.5 text-xs font-bold text-white" onClick={() => openCase(point)}>View case</button>
          </div>
        </Popup>
      </CircleMarker>
    </>
  )
}

function MapLegend() {
  const items = [
    ["#247f73", "Low"],
    ["#9a7840", "Medium"],
    ["#c44f46", "High"],
    ["#b42318", "Critical"],
  ]
  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-[450] rounded-md border border-[#c9d5dd] bg-white/95 p-3 text-[11px] font-bold text-[#40536a] shadow-sm">
      <div className="mb-2 text-xs text-[#263747]">Case priority</div>
      <div className="grid gap-1.5">
        {items.map(([color, label]) => <div key={label} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />{label}</div>)}
      </div>
    </div>
  )
}

function districtMapCenter(district: string, districts: GeoJsonCollection): [number, number] {
  const feature = districtFeatureByName(district, districts)
  return [numberProperty(feature, "center_lat") ?? geometryCentroid(feature)[0] ?? -19.0, numberProperty(feature, "center_lon") ?? geometryCentroid(feature)[1] ?? 29.8]
}

function districtFeatureByName(name: string, districts: GeoJsonCollection) {
  return districts.features.find((feature) => sameMapBoundaryName(feature.properties.adm2_name, name))
}

function provinceFeatureByName(name: string, provinces: GeoJsonCollection) {
  return provinces.features.find((feature) => sameMapBoundaryName(feature.properties.adm1_name, name))
}

function regionDistrictNames(region: string, districts: GeoJsonCollection) {
  const provinceDistricts = districts.features.filter((feature) => sameMapBoundaryName(feature.properties.adm1_name, region)).map((feature) => String(feature.properties.adm2_name || "")).filter(Boolean)
  if (provinceDistricts.length) return provinceDistricts
  const legacy = zimbabweRegions.find((item) => sameMapBoundaryName(item.name, region))?.districts ?? []
  return legacy.length ? legacy : districts.features.some((feature) => sameMapBoundaryName(feature.properties.adm2_name, region)) ? [region] : []
}

function districtCaseCount(feature: GeoJsonFeature | undefined, casePoints: DashboardCasePoint[]) {
  const name = feature?.properties?.adm2_name
  return casePoints.filter((point) => sameMapBoundaryName(point.district, name)).length
}

function districtWorkloadColor(count: number, maxCount: number, active: boolean) {
  if (!count) return active ? "#c8e4e0" : "#f2f6f8"
  const intensity = count / maxCount
  if (intensity > 0.66) return "#78b9b0"
  if (intensity > 0.33) return "#9bcfc8"
  return "#c2e1dd"
}

function dashboardMapMarkerColor(point: DashboardCasePoint) {
  if (point.priority === "Critical") return "#b42318"
  if (point.priority === "High") return "#c44f46"
  if (point.priority === "Medium") return "#9a7840"
  return "#247f73"
}

function clusterDashboardMarkers(markers: DashboardCasePoint[]) {
  const groups = new Map<string, DashboardCasePoint[]>()
  markers.forEach((marker) => {
    const key = `${Math.round(marker.lat / 0.08)}:${Math.round(marker.lng / 0.08)}`
    groups.set(key, [...(groups.get(key) || []), marker])
  })
  return Array.from(groups.entries()).map(([id, items]) => ({
    id,
    items,
    lat: items.reduce((sum, item) => sum + item.lat, 0) / items.length,
    lng: items.reduce((sum, item) => sum + item.lng, 0) / items.length,
  }))
}

function clusterColor(items: DashboardCasePoint[]) {
  if (items.some((item) => item.priority === "Critical")) return "#b42318"
  if (items.some((item) => item.priority === "High")) return "#d76b61"
  if (items.some((item) => item.priority === "Medium")) return "#c6a15b"
  return "#3f9c90"
}

function clusterRadius(count: number) {
  return count >= 10 ? 17 : count >= 4 ? 14 : 12
}

function numberProperty(feature: GeoJsonFeature | undefined, key: string) {
  const value = feature?.properties?.[key]
  return typeof value === "number" ? value : typeof value === "string" && value ? Number(value) : undefined
}

function geometryCentroid(feature: GeoJsonFeature | undefined): [number | undefined, number | undefined] {
  const coordinates: number[][] = []
  function collect(value: unknown) {
    if (!Array.isArray(value)) return
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      coordinates.push(value as number[])
      return
    }
    value.forEach(collect)
  }
  collect((feature?.geometry as { coordinates?: unknown } | undefined)?.coordinates)
  if (!coordinates.length) return [undefined, undefined]
  const sums = coordinates.reduce((acc, point) => ({ lng: acc.lng + point[0], lat: acc.lat + point[1] }), { lat: 0, lng: 0 })
  return [sums.lat / coordinates.length, sums.lng / coordinates.length]
}

function mapBoundaryName(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\b(district|province)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function sameMapBoundaryName(left: unknown, right: unknown) {
  return mapBoundaryName(left) === mapBoundaryName(right)
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
        <Info label="Source name" value={alert.information_source_name || "Not captured"} />
        <Info label="Source contact" value={alert.information_source_contact || "Not captured"} />
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
    </div>
  )
}

function AlertCapturedDetails({ alert }: { alert: AlertRecord }) {
  const empty = "Not captured"
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
        ["Chief name", alert.chief_name || empty],
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
        ["Source name", alert.information_source_name || empty],
        ["Source contact", alert.information_source_contact || empty],
        ["Relationship to child", alert.information_source_relationship_to_child || alert.relationship_to_child || empty],
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
        ["Perpetrator known", alert.alleged_perpetrator_known || empty],
        ["Alleged perpetrator name", alert.alleged_perpetrator_name || empty],
        ["Relationship to child", alert.alleged_perpetrator_relationship || empty],
        ["Alleged perpetrator sex", alert.alleged_perpetrator_sex || empty],
        ["Race", alert.alleged_perpetrator_race || empty],
        ["Perpetrator has access", alert.perpetrator_has_access || empty],
        ["Referred to police", alert.referred_to_police || empty],
        ["Police referral date", alert.police_referral_date || empty],
        ["Court appearance scheduled", alert.court_appearance_scheduled || empty],
        ["Court appearance date", alert.court_appearance_date || empty],
        ["Conviction determined", alert.conviction_determined || empty],
        ["Conviction date", alert.conviction_date || empty],
      ],
    },
    {
      title: "Attachments",
      fields: [["Files", "No attachments captured for this alert."]],
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
  const activeNav = active === "triage" ? "case-alerts" : ["attention", "high-priority-cases"].includes(active) ? "allocated-cases" : active
  const isDistrictHead = user.profile.role === "DISTRICT_HEAD"
  const isSystemAdmin = isAdminRole(user.profile.role)
  const sidebarUserName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username
  const sidebarUserInitials = sidebarUserName.split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "U"
  const groups = [
    {
      label: "Case Management",
      icon: File,
      children: [
        ["case-alerts", "Case Alert"],
        ["case-intake", "Case Intake"],
        ...(isDistrictHead ? [["allocation", "Unallocated Cases"] as NavChild] : []),
        ["allocated-cases", "Allocated Cases"],
      ],
    },
    ...(isDistrictHead ? [{
      label: "Approvals",
      icon: ClipboardCheck,
      children: [
        ["assessment-care-plan-approvals", "Assessment & Care Plan"] as NavChild,
        ["update-requests", "Change Requests"] as NavChild,
        ["closure-approvals", "Case Closures"] as NavChild,
      ],
    }] : []),
    ...(isSystemAdmin ? [
      {
        label: "Administration Setup",
        icon: File,
        children: [["provinces", "Provinces"] as NavChild, ["districts", "Districts"] as NavChild, ["relationship-types", "Relationship Types"] as NavChild, ["setup", "User Management"] as NavChild],
      },
    ] : []),
    {
      label: "Partner Management",
      icon: File,
      children: [["district-wards", "District Wards"], ["ccws", "CCWs"], ["partners-in-district", "Partners in District"], ["register-courts", "Register Courts"]],
    },
    {
      label: "Places of Safety",
      icon: File,
      children: [["places", "Places of Safety"]],
    },
    {
      label: "Reports & Analytics",
      icon: BarChart3,
      children: [["reports", "Reports"], ["analytics", "Analytics"]],
    },
    ...(isSystemAdmin ? [
      {
        label: "Audit Trail",
        icon: History,
        children: [["audit", "Audit Trail"] as NavChild],
      },
    ] : []),
  ] satisfies Array<{ label: string; icon: ElementType; children: NavChild[] }>
  function toggleGroup(label: string) {
    setExpandedGroups((items) => (items.includes(label) ? items.filter((item) => item !== label) : [...items, label]))
  }

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-[#3c4866] text-white shadow-sm">
      <div className={`flex h-[72px] shrink-0 items-center border-b border-white/25 bg-[#24384d] ${collapsed ? "justify-center px-2" : "justify-between px-5"}`}>
        {!collapsed && (
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center">
              <img className="h-10 w-10 object-contain drop-shadow-sm" src={coatOfArms} alt="National coat of arms" />
            </span>
            <div className="text-[24px] font-black uppercase leading-none tracking-[0.12em] text-white drop-shadow-sm">NCPMIS</div>
          </div>
        )}
        <button className="grid h-9 w-9 place-items-center rounded-md bg-white/10 text-white/90 transition hover:bg-white/15 hover:text-white" onClick={onToggle} aria-label="Collapse sidebar">
          <Menu className="h-5 w-5" />
        </button>
      </div>
      {!collapsed && <div className="shrink-0 border-t border-white/70 px-5 py-3">
        <div className="text-[15px] font-bold">{user.username}</div>
        <div className="mt-3 flex items-center gap-2 text-[14px]"><span className="h-3 w-3 rounded-full bg-[#7bd998]" /> Online</div>
      </div>}
      {!collapsed && <div className="shrink-0 px-3 pb-4">
        <label className="flex h-10 items-center rounded-sm bg-[#56637d] text-white/80">
          <input className="min-w-0 flex-1 bg-transparent px-3 text-[13px] outline-none placeholder:text-white/60" placeholder="Search..." />
          <Search className="mr-3 h-4 w-4 text-[#d4b67a]" />
        </label>
      </div>}
      {!collapsed && <div className="shrink-0 px-7 pb-3 text-[12px] font-bold uppercase text-white drop-shadow">Navigation Menu</div>}
      <nav className="app-sidebar-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        <button
          className={`flex h-11 w-full items-center gap-3 rounded-sm border-l-4 ${collapsed ? "justify-center px-0" : "px-4"} text-left text-[14px] font-semibold ${activeNav === "dashboard" ? "border-[#23d3c0] bg-[#33405b]" : "border-transparent hover:bg-[#33405b]"}`}
          onClick={() => setActive("dashboard")}
          title="Dashboard"
        >
          <LayoutDashboard className="h-4 w-4" /> {!collapsed && "Dashboard"}
        </button>
        {groups.map((group) => {
          const GroupIcon = group.icon
          const groupActive = group.children.some(([key]) => key === activeNav)
          const expanded = expandedGroups.includes(group.label) || groupActive
          return (
            <div key={group.label} className="rounded-sm border border-white/5 bg-[#37435f]/55">
              <button
                className={`flex h-11 w-full items-center border-l-4 ${collapsed ? "justify-center px-0" : "justify-between px-4"} text-left text-[14px] font-semibold ${groupActive ? "border-[#23d3c0] bg-[#33405b]" : "border-transparent hover:bg-[#33405b]"}`}
                onClick={() => (collapsed ? setActive(group.children[0][0]) : toggleGroup(group.label))}
                title={group.label}
              >
                <span className="flex min-w-0 items-center gap-2"><GroupIcon className="h-4 w-4 shrink-0" /> {!collapsed && <span className="truncate whitespace-nowrap">{group.label}</span>}</span>
                {!collapsed && <ChevronDown className={`h-4 w-4 text-white/70 transition-transform ${expanded ? "rotate-180" : ""}`} />}
              </button>
              {!collapsed && expanded && group.children.map(([key, label]) => (
                <button
                  key={key}
                  className={`flex h-10 w-full items-center border-l-4 pl-11 pr-4 text-left text-[13px] ${activeNav === key ? "border-[#23d3c0] bg-[#56637d] text-white" : "border-transparent bg-[#3a4663] text-white hover:bg-[#4b5874]"}`}
                  onClick={() => setActive(key)}
                >
                  <span className="truncate whitespace-nowrap">{label}</span>
                </button>
              ))}
            </div>
          )
        })}
      </nav>
      <div className={`shrink-0 border-t border-white/10 ${collapsed ? "grid place-items-center px-2 py-3" : "px-4 py-3"}`}>
        <div className={`flex items-center ${collapsed ? "justify-center" : "gap-3"}`} title={`${sidebarUserName} | ${user.profile.roleLabel}`}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/12 text-xs font-extrabold text-white">{sidebarUserInitials}</span>
          {!collapsed && <div className="min-w-0"><div className="truncate text-sm font-semibold text-white">{sidebarUserName}</div><div className="mt-0.5 truncate text-xs text-white/55">{user.profile.roleLabel}</div></div>}
        </div>
      </div>
    </aside>
  )
}

function InternalTopBar({
  currentView,
  user,
  notifications,
  onOpenNotification,
  onViewAll,
  onLogout,
  onProfile,
}: {
  currentView: string
  user: ApiUser
  notifications: WorkflowNotification[]
  onOpenNotification: (notification: WorkflowNotification) => void
  onViewAll: () => void
  onLogout: () => void
  onProfile: () => void
}) {
  const [open, setOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const activeNotifications = notifications.filter((notification) => !notification.resolvedAt)
  const notificationCount = activeNotifications.filter((notification) => notification.unread).length
  const activeCount = activeNotifications.length
  const pageTitles: Record<string, string> = {
    dashboard: "Dashboard",
    "case-alerts": "Case Alert",
    triage: "Alert Triage",
    "captured-cases": "Captured Cases",
    "case-intake": "Case Intake",
    "new-intake": "Case Intake",
    intake: "Case Intake",
    screening: "Initial Screening",
    review: "Unallocated Cases",
    "assessment-care-plan-approvals": "Assessment & Care Plan Approvals",
    "update-requests": "Change Requests",
    "closure-approvals": "Case Closure Approvals",
    allocation: "Unallocated Cases",
    attention: "Cases Requiring Attention",
    "high-priority-cases": "My High Priority Cases",
    "allocated-cases": "Allocated Cases",
    reports: "Reports",
    "report-history": "Report History",
    analytics: "Analytics",
    audit: "Audit Trail",
    notifications: "Notifications",
    setup: "User Management",
    "internal-profile": "Profile",
    provinces: "Provinces",
    districts: "Districts",
    "district-wards": "District Wards",
    ccws: "CCWs",
    "partners-in-district": "Partners in District",
    "register-courts": "Register Courts",
    services: "Services",
    "relationship-types": "Relationship Types",
    places: "Places of Safety",
    events: "Case Events",
  }
  const currentPage = pageTitles[currentView] || "Dashboard"

  return (
    <>
      <div className="flex h-[58px] items-center justify-between bg-white px-4 text-[#4b4f56] shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-7 w-1 rounded-full bg-[#008c7a]" />
          <div className="min-w-0">
            <div className="text-[18px] font-bold leading-tight text-[#263747]">{currentPage}</div>
            <div className="text-[12px] font-semibold uppercase text-[#64748b]">NCPMIS workspace</div>
          </div>
        </div>
        <div className="flex items-center gap-7">
          <button className="relative grid h-8 min-w-5 place-items-center" title="Notifications" onClick={() => setDrawerOpen(true)}>
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
      {drawerOpen && (
        <NotificationDrawer
          notifications={activeNotifications}
          unreadCount={notificationCount}
          activeCount={activeCount}
          onClose={() => setDrawerOpen(false)}
          onViewAll={() => { setDrawerOpen(false); onViewAll() }}
          onOpenNotification={(notification) => { setDrawerOpen(false); onOpenNotification(notification) }}
        />
      )}
      <div className="h-[17px] bg-[#24384d]" />
    </>
  )
}

type ReportChartRow = { name?: string; month?: string; value: number }
type ReportsPayload = {
  generatedAt: string
  scope: string
  reportTitle?: string
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
}

function ReportsAnalytics({ mode, user, alerts, cases, users, districts, provinces, onOpenHistory }: { mode: "reports" | "analytics"; user: ApiUser; alerts: AlertRecord[]; cases: CaseRecord[]; users: ApiUser[]; districts: DistrictOption[]; provinces: ProvinceOption[]; onOpenHistory?: () => void }) {
  const reportTypes = [
    { value: "case-statistics", label: "Case Statistics", description: "Case volumes, status and allocation summary." },
    { value: "risk-trends", label: "Risk & Abuse Trends", description: "Risk levels, child protection concerns and monthly trends." },
    { value: "intake-screening", label: "Intake & Screening", description: "Submitted intakes, screening progress and allocation flow." },
    { value: "assessment", label: "Assessment Report", description: "Assessment completion, overdue cases and SLA status." },
    { value: "referrals-services", label: "Referrals & Services", description: "Referral and service activity across the selected period." },
    { value: "review-closure", label: "Case Review & Closure", description: "Case reviews, closure progress and outstanding work." },
    { value: "ccw-summary", label: "CCW Monthly Case Summary", description: "Monthly child protection summary for community case workers." },
    { value: "geographic", label: "Geographic Report", description: "Cases and alerts by the locations available in your scope." },
  ]
  const nationalReportRoles = new Set(["SYS_ADMIN", "DEPUTY_DIRECTOR", "DIRECTOR", "PROGRAMME_OFFICER"])
  const isNationalReportUser = nationalReportRoles.has(user.profile.role)
  const isDistrictReportUser = ["DISTRICT_HEAD", "DSDO"].includes(user.profile.role)
  const userDistrictName = user.profile.districtName || ""
  const userProvinceName = user.profile.provinceName || districts.find((item) => item.name === userDistrictName)?.provinceName || ""
  const [reportType, setReportType] = useState(reportTypes[0].value)
  const [reportFormat, setReportFormat] = useState<"pdf" | "excel">("pdf")
  const [selectedProvince, setSelectedProvince] = useState(isNationalReportUser ? "" : userProvinceName)
  const [selectedDistrict, setSelectedDistrict] = useState(isDistrictReportUser ? userDistrictName : "")
  const [statusFilter, setStatusFilter] = useState("")
  const [riskFilter, setRiskFilter] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [data, setData] = useState<ReportsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const isReportsPage = mode === "reports"
  const selectedReport = reportTypes.find((item) => item.value === reportType) || reportTypes[0]
  const provinceOptions = Array.from(new Set(districts.map((item) => item.provinceName))).filter(Boolean).sort()
  const reportDistrictOptions = districts.filter((item) => !selectedProvince || item.provinceName === selectedProvince)
  const reportStatuses = Array.from(new Set(cases.map((item) => item.status))).filter(Boolean).sort()
  const reportCategories = Array.from(new Set(cases.map((item) => item.intakeDraft?.case_category || "Uncategorized"))).filter(Boolean).sort()
  const query = new URLSearchParams()
  if (startDate) query.set("start", startDate)
  if (endDate) query.set("end", endDate)
  if (isReportsPage) query.set("report_type", reportType)
  if (isReportsPage && selectedProvince) query.set("province", selectedProvince)
  if (isReportsPage && selectedDistrict) query.set("district", selectedDistrict)
  if (isReportsPage && statusFilter) query.set("status", statusFilter)
  if (isReportsPage && riskFilter) query.set("risk", riskFilter)
  if (isReportsPage && categoryFilter) query.set("category", categoryFilter)
  const queryString = query.toString() ? `?${query.toString()}` : ""

  async function loadReports() {
    setLoading(true)
    setError("")
    try {
      setData(await apiGet<ReportsPayload>(`/reports/analytics/${queryString}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate this report.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isReportsPage) void loadReports()
  }, [isReportsPage, queryString])

  useEffect(() => {
    if (!isNationalReportUser && userProvinceName) setSelectedProvince(userProvinceName)
    if (isDistrictReportUser && userDistrictName) setSelectedDistrict(userDistrictName)
  }, [isNationalReportUser, isDistrictReportUser, userProvinceName, userDistrictName])

  async function downloadReport(format: "excel" | "pdf") {
    setLoading(true)
    setError("")
    const token = window.sessionStorage.getItem("ncms_access_token")
    try {
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
      link.download = `${reportType}-report.${format === "excel" ? "xlsx" : "pdf"}`
      link.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not generate ${format.toUpperCase()} report.`)
    } finally {
      setLoading(false)
    }
  }

  async function generateSelectedReport() {
    await downloadReport(reportFormat)
  }

  function resetReportFilters() {
    setReportFormat("pdf")
    setSelectedProvince(isNationalReportUser ? "" : userProvinceName)
    setSelectedDistrict(isDistrictReportUser ? userDistrictName : "")
    setStatusFilter("")
    setRiskFilter("")
    setCategoryFilter("")
    setStartDate("")
    setEndDate("")
    setData(null)
    setError("")
  }

  const charts = data?.charts
  const summary = data?.summary

  if (!isReportsPage) {
    return (
      <AnalyticsWorkspace
        user={user}
        alerts={alerts}
        cases={cases}
        users={users}
        districts={districts}
        data={data}
        loading={loading}
        error={error}
        startDate={startDate}
        endDate={endDate}
        setStartDate={setStartDate}
        setEndDate={setEndDate}
        onRetry={loadReports}
      />
    )
  }

  return (
    <div className="space-y-5">
      <Panel title={isReportsPage ? "Reports" : "Analytics"} icon={BarChart3} action={isReportsPage ? <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-semibold text-[#475569]">{user.profile.roleLabel} scope</span><button className="inline-flex h-9 items-center gap-2 rounded-md border border-[#0f766e] bg-white px-3 text-sm font-bold text-[#0f766e] hover:bg-[#eef9f6]" onClick={onOpenHistory}><History className="h-4 w-4" />Report History</button></div> : `${user.profile.roleLabel} scope`}>
        {isReportsPage ? <>
          <div>
            <p className="text-sm font-semibold leading-6 text-[#64748b]">Choose a report and format, confirm the authorised geographic scope, and apply only the case filters needed for the output.</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-12">
              <div className="xl:col-span-8"><Field label="Report type" required={false}><select className={inputClass} value={reportType} onChange={(event) => { setReportType(event.target.value); setData(null) }}>{reportTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field></div>
              <div className="xl:col-span-4"><Field label="Format"><select className={inputClass} value={reportFormat} onChange={(event) => setReportFormat(event.target.value as "pdf" | "excel")}><option value="pdf">PDF</option><option value="excel">Excel</option></select></Field></div>
              <div className="xl:col-span-4"><Field label="Province" required={false}><select className={`${inputClass} disabled:cursor-not-allowed disabled:bg-[#f1f5f9] disabled:text-[#64748b]`} value={selectedProvince} disabled={!isNationalReportUser} onChange={(event) => { setSelectedProvince(event.target.value); setSelectedDistrict("") }}><option value="">{isNationalReportUser ? "All provinces" : userProvinceName || "Province not assigned"}</option>{provinceOptions.map((item) => <option key={item}>{item}</option>)}</select></Field></div>
              <div className="xl:col-span-4"><Field label="District" required={false}><select className={`${inputClass} disabled:cursor-not-allowed disabled:bg-[#f1f5f9] disabled:text-[#64748b]`} value={selectedDistrict} disabled={isDistrictReportUser} onChange={(event) => setSelectedDistrict(event.target.value)}><option value="">{isDistrictReportUser ? userDistrictName || "District not assigned" : "All districts"}</option>{reportDistrictOptions.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></Field></div>
              <div className="xl:col-span-4"><AnalyticsSelect label="Case status" value={statusFilter} options={reportStatuses} onChange={setStatusFilter} /></div>
              <div className="xl:col-span-4"><AnalyticsSelect label="Case category" value={categoryFilter} options={reportCategories} onChange={setCategoryFilter} /></div>
              <div className="xl:col-span-4"><AnalyticsSelect label="Risk level" value={riskFilter} options={["CRITICAL", "HIGH", "MEDIUM", "LOW", "PENDING"]} onChange={setRiskFilter} /></div>
              <div className="grid gap-4 sm:grid-cols-2 xl:col-span-4"><Field label="From" required={false}><input className={inputClass} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></Field><Field label="To" required={false}><input className={inputClass} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></Field></div>
            </div>
            <div className="mt-4 rounded-md border border-[#d8dee8] bg-[#f8fafc] px-4 py-3 text-sm"><span className="font-bold text-[#263747]">{selectedReport.label}: </span><span className="font-semibold text-[#64748b]">{selectedReport.description}</span></div>
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[#edf0f4] pt-4"><button className="inline-flex h-11 items-center gap-2 rounded-md border border-[#d8dee8] bg-white px-5 text-sm font-bold text-[#50617a]" onClick={resetReportFilters}><RotateCcw className="h-4 w-4" />Reset</button><button className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#0f766e] px-6 text-sm font-bold text-white shadow-sm disabled:opacity-50" disabled={loading || Boolean(startDate && endDate && startDate > endDate)} onClick={() => void generateSelectedReport()}><FileText className="h-4 w-4" />{loading ? "Generating…" : `Generate ${reportFormat.toUpperCase()}`}</button></div>
          </div>
        </> : <div className="flex flex-wrap items-end gap-3"><Field label="From"><input className={inputClass} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></Field><Field label="To"><input className={inputClass} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></Field></div>}
        {error && <ErrorBanner message={error} />}
        {loading && <Notice text="Loading report data..." />}
        {!isReportsPage && summary && (
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

      {!isReportsPage && charts && (
        <div className="grid gap-4 xl:grid-cols-2">
          <ReportChart title="Monthly Case Trend" option={lineOption(charts.monthlyTrend, "month")} />
          <ReportChart title="Cases by District" option={barOption(charts.casesByDistrict)} />
          <ReportChart title="Risk Distribution" option={pieOption(charts.riskDistribution)} />
          <ReportChart title="Assessment Completion" option={pieOption(charts.assessmentStatus)} />
          <ReportChart title="Intake to Closure Funnel" option={funnelOption(charts.funnel)} />
          <ReportChart title="Case Categories" option={barOption(charts.concernDistribution)} />
        </div>
      )}
    </div>
  )
}

type ReportHistoryRecord = {
  id: number
  reference: string
  reportType: string
  reportTitle: string
  outputFormat: "PDF" | "EXCEL"
  filters: Record<string, string>
  summary: Record<string, string | number | null>
  provinceName: string
  districtName: string
  generatedBy: string
  generatedByRole: string
  generatedAt: string
}

type PaginatedReportHistory = {
  count: number
  results: ReportHistoryRecord[]
}

function ReportHistory({ onBack }: { onBack: () => void }) {
  const [records, setRecords] = useState<ReportHistoryRecord[]>([])
  const [totalRows, setTotalRows] = useState(0)
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [search, setSearch] = useState("")
  const [formatFilter, setFormatFilter] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [downloadingId, setDownloadingId] = useState<number | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ page: `${page}`, page_size: `${rowsPerPage}` })
      if (search.trim()) query.set("search", search.trim())
      if (formatFilter) query.set("format", formatFilter)
      setLoading(true)
      setError("")
      void apiGet<PaginatedReportHistory>(`/report-history/?${query.toString()}`)
        .then((response) => {
          setRecords(response.results)
          setTotalRows(response.count)
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Could not load report history."))
        .finally(() => setLoading(false))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [page, rowsPerPage, search, formatFilter, refreshKey])

  const pageCount = Math.max(1, Math.ceil(totalRows / rowsPerPage))
  const safePage = Math.min(page, pageCount)
  const pageStart = totalRows ? (safePage - 1) * rowsPerPage + 1 : 0
  const pageEnd = Math.min(safePage * rowsPerPage, totalRows)

  async function downloadAgain(record: ReportHistoryRecord) {
    setDownloadingId(record.id)
    setError("")
    try {
      const query = new URLSearchParams({ report_type: record.reportType })
      Object.entries(record.filters || {}).forEach(([key, value]) => {
        if (value) query.set(key, value)
      })
      const format = record.outputFormat === "EXCEL" ? "excel" : "pdf"
      const token = window.sessionStorage.getItem("ncms_access_token")
      const response = await fetch(`/api/reports/export/${format}/?${query.toString()}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!response.ok) throw new Error(`Could not download the ${record.outputFormat} report.`)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `${record.reportType}-report.${format === "excel" ? "xlsx" : "pdf"}`
      link.click()
      URL.revokeObjectURL(url)
      setPage(1)
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download this report.")
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="Report History" icon={History} action={<button className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d8dee8] bg-white px-3 text-sm font-bold text-[#50617a] hover:border-[#0f766e] hover:text-[#0f766e]" onClick={onBack}><ChevronLeft className="h-4 w-4" />Back to Reports</button>}>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#64748b]">A traceable record of reports generated within your authorised scope.</p>
            <p className="mt-1 text-xs font-semibold text-[#94a3b8]">Every successful PDF and Excel export is recorded automatically.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Search" required={false}><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-[#94a3b8]" /><input className={`${inputClass} w-72 pl-9`} value={search} placeholder="Reference, report, user or location" onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></div></Field>
            <Field label="Format" required={false}><select className={`${inputClass} w-36`} value={formatFilter} onChange={(event) => { setFormatFilter(event.target.value); setPage(1) }}><option value="">All formats</option><option value="PDF">PDF</option><option value="EXCEL">Excel</option></select></Field>
            <button className="inline-flex h-11 items-center gap-2 rounded-md border border-[#d8dee8] bg-white px-4 text-sm font-bold text-[#50617a] hover:border-[#0f766e] hover:text-[#0f766e]" onClick={() => setRefreshKey((value) => value + 1)}><RotateCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button>
          </div>
        </div>
        {error && <ErrorBanner message={error} />}
        <div className="overflow-hidden rounded-md border border-[#d8dee8]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse bg-white text-left text-sm">
              <thead className="bg-[#f1f6f8] text-[#365269]"><tr>{["Report Reference", "Report", "Format", "Scope", "Reporting Period", "Generated By", "Generated On", "Status", "Action"].map((heading) => <th key={heading} className="border-b border-[#ccd8df] px-3 py-3 text-xs font-bold uppercase tracking-wide">{heading}</th>)}</tr></thead>
              <tbody>
                {loading && !records.length ? <tr><td colSpan={9} className="px-4 py-10 text-center font-semibold text-[#64748b]">Loading report history…</td></tr> : records.length ? records.map((record) => {
                  const period = record.filters.start || record.filters.end ? `${record.filters.start || "Beginning"} – ${record.filters.end || "Present"}` : "All available dates"
                  const scope = record.districtName || record.provinceName || "All authorised locations"
                  return <tr key={record.id} className="odd:bg-white even:bg-[#fbfcfd] hover:bg-[#f4faf8]">
                    <td className="whitespace-nowrap border-b border-[#edf0f4] px-3 py-3 font-bold text-[#30528c]">{record.reference}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3"><div className="font-bold text-[#263747]">{record.reportTitle}</div><div className="mt-1 text-xs text-[#64748b]">{record.reportType.replace(/-/g, " ")}</div></td>
                    <td className="border-b border-[#edf0f4] px-3 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${record.outputFormat === "PDF" ? "bg-[#fff1f0] text-[#b42318]" : "bg-[#eaf8ef] text-[#16834a]"}`}>{record.outputFormat === "EXCEL" ? "EXCEL" : "PDF"}</span></td>
                    <td className="border-b border-[#edf0f4] px-3 py-3 font-semibold text-[#50617a]">{scope}</td>
                    <td className="whitespace-nowrap border-b border-[#edf0f4] px-3 py-3">{period}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3"><div className="font-semibold text-[#263747]">{record.generatedBy}</div><div className="mt-1 text-xs text-[#64748b]">{record.generatedByRole}</div></td>
                    <td className="whitespace-nowrap border-b border-[#edf0f4] px-3 py-3">{formatWorkflowDateTime(record.generatedAt)}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3"><span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f6f3] px-2.5 py-1 text-xs font-bold text-[#0f766e]"><CheckCircle2 className="h-3.5 w-3.5" />Completed</span></td>
                    <td className="border-b border-[#edf0f4] px-3 py-3"><button className="inline-flex h-9 items-center gap-2 rounded-md border border-[#0f766e] px-3 text-xs font-bold text-[#0f766e] disabled:opacity-50" disabled={downloadingId === record.id} onClick={() => void downloadAgain(record)}><Download className="h-4 w-4" />{downloadingId === record.id ? "Preparing…" : "Download"}</button></td>
                  </tr>
                }) : <tr><td colSpan={9} className="px-4 py-12 text-center"><History className="mx-auto h-9 w-9 text-[#94a3b8]" /><div className="mt-3 font-bold text-[#50617a]">No generated reports found</div><div className="mt-1 text-sm text-[#64748b]">Generate a report and it will appear here automatically.</div></td></tr>}
              </tbody>
            </table>
          </div>
          <TablePagination totalRows={totalRows} pageStart={pageStart} pageEnd={pageEnd} rowsPerPage={rowsPerPage} setRowsPerPage={(value) => { setRowsPerPage(value); setPage(1) }} page={safePage} pageCount={pageCount} setPage={setPage} />
        </div>
      </Panel>
    </div>
  )
}

type AnalyticsScope = "officer" | "district" | "province" | "national"
type AnalyticsFilterKey = "ward" | "officer" | "province" | "district"
type AnalyticsRoleConfig = {
  scope: AnalyticsScope
  scopeLabel: string
  geographyLabel: string
  geographyGroupBy: "ward" | "district" | "province"
  performanceEntity: "self" | "officer" | "district" | "province"
  filters: AnalyticsFilterKey[]
  kpiLabels: [string, string, string, string, string, string]
}
type AnalyticsFilters = {
  start: string
  end: string
  ward: string
  officer: string
  province: string
  district: string
  category: string
  risk: string
  status: string
  sex: string
  ageGroup: string
}

function analyticsRoleConfig(user: ApiUser): AnalyticsRoleConfig {
  const nationalRoles = new Set(["SYS_ADMIN", "DEPUTY_DIRECTOR", "DIRECTOR", "PROGRAMME_OFFICER"])
  if (nationalRoles.has(user.profile.role)) {
    return {
      scope: "national",
      scopeLabel: "National Scope",
      geographyLabel: "Cases by Province",
      geographyGroupBy: "province",
      performanceEntity: "province",
      filters: ["province", "district", "ward"],
      kpiLabels: ["National New Cases", "National Active Cases", "National Closed Cases", "National High-Risk Cases", "Provinces Below Target", "Average Processing Time"],
    }
  }
  if (user.profile.role === "PROVINCIAL_HEAD") {
    return {
      scope: "province",
      scopeLabel: "Provincial Scope",
      geographyLabel: "Cases by District",
      geographyGroupBy: "district",
      performanceEntity: "district",
      filters: ["district", "ward"],
      kpiLabels: ["New Provincial Cases", "Active Cases", "Closed Cases", "High-Risk Cases", "Districts Below Target", "Average Processing Time"],
    }
  }
  if (user.profile.role === "DISTRICT_HEAD") {
    return {
      scope: "district",
      scopeLabel: "District Scope",
      geographyLabel: "Cases by Ward",
      geographyGroupBy: "ward",
      performanceEntity: "officer",
      filters: ["ward", "officer"],
      kpiLabels: ["New District Cases", "Active District Cases", "Closed Cases", "High-Risk Cases", "Overdue Assessments", "Average Allocation Time"],
    }
  }
  return {
    scope: "officer",
    scopeLabel: "My Caseload",
    geographyLabel: "My Cases by Ward",
    geographyGroupBy: "ward",
    performanceEntity: "self",
    filters: ["ward"],
    kpiLabels: ["My New Cases", "My Active Cases", "My Closed Cases", "My High-Risk Cases", "My Overdue Tasks", "My Average Case Age"],
  }
}

function AnalyticsWorkspace({
  user,
  alerts,
  cases,
  users,
  districts,
  data,
  loading,
  error,
  startDate,
  endDate,
  setStartDate,
  setEndDate,
  onRetry,
}: {
  user: ApiUser
  alerts: AlertRecord[]
  cases: CaseRecord[]
  users: ApiUser[]
  districts: DistrictOption[]
  data: ReportsPayload | null
  loading: boolean
  error: string
  startDate: string
  endDate: string
  setStartDate: (value: string) => void
  setEndDate: (value: string) => void
  onRetry: () => Promise<void>
}) {
  const config = analyticsRoleConfig(user)
  const emptyFilters: AnalyticsFilters = { start: startDate, end: endDate, ward: "", officer: "", province: "", district: "", category: "", risk: "", status: "", sex: "", ageGroup: "" }
  const [draftFilters, setDraftFilters] = useState<AnalyticsFilters>(emptyFilters)
  const [appliedFilters, setAppliedFilters] = useState<AnalyticsFilters>(emptyFilters)
  const [draftPeriodPreset, setDraftPeriodPreset] = useState("")
  const [appliedPeriodPreset, setAppliedPeriodPreset] = useState("")
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
  const [showAllLocations, setShowAllLocations] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailSearch, setDetailSearch] = useState("")
  const [detailSort, setDetailSort] = useState("newest")
  const [detailPage, setDetailPage] = useState(1)
  const detailPanelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!filterDrawerOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFilterDrawerOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [filterDrawerOpen])

  const officerName = userDisplayName(user)
  const baseCases = config.scope === "officer"
    ? cases.filter((item) => item.allocatedOfficer === officerName || item.allocatedOfficer === user.username || item.intakeOfficer === officerName || item.intakeOfficer === user.username)
    : cases
  const periodStart = appliedFilters.start ? new Date(`${appliedFilters.start}T00:00:00`).getTime() : null
  const periodEnd = appliedFilters.end ? new Date(`${appliedFilters.end}T23:59:59`).getTime() : null
  const districtProvince = new Map(districts.map((district) => [district.name, district.provinceName]))
  const inPeriod = (value: string) => {
    const time = new Date(value).getTime()
    if (!Number.isFinite(time)) return !periodStart && !periodEnd
    return (!periodStart || time >= periodStart) && (!periodEnd || time <= periodEnd)
  }
  const ageMatches = (ageValue: string) => {
    if (!appliedFilters.ageGroup) return true
    const age = Number.parseInt(ageValue, 10)
    if (!Number.isFinite(age)) return appliedFilters.ageGroup === "Unknown"
    if (appliedFilters.ageGroup === "0-5") return age <= 5
    if (appliedFilters.ageGroup === "6-12") return age >= 6 && age <= 12
    if (appliedFilters.ageGroup === "13-17") return age >= 13 && age <= 17
    return age >= 18
  }
  const caseMatchesDimensions = (item: CaseRecord) => {
    if (appliedFilters.ward && item.ward !== appliedFilters.ward) return false
    if (appliedFilters.district && item.district !== appliedFilters.district) return false
    if (appliedFilters.province && districtProvince.get(item.district) !== appliedFilters.province) return false
    if (appliedFilters.officer && item.allocatedOfficer !== appliedFilters.officer) return false
    if (appliedFilters.category && item.concern !== appliedFilters.category) return false
    if (appliedFilters.risk && item.riskLevel.toUpperCase() !== appliedFilters.risk) return false
    if (appliedFilters.status && item.status !== appliedFilters.status && item.closureStatus !== appliedFilters.status) return false
    if (appliedFilters.sex && item.sex !== appliedFilters.sex) return false
    return ageMatches(item.age)
  }
  const filteredCases = baseCases.filter((item) => inPeriod(item.createdAt) && caseMatchesDimensions(item))
  const periodLength = periodStart != null && periodEnd != null ? periodEnd - periodStart + 1 : null
  const previousStart = periodLength != null && periodStart != null ? periodStart - periodLength : null
  const previousEnd = periodStart != null ? periodStart - 1 : null
  const previousCases = previousStart != null && previousEnd != null
    ? baseCases.filter((item) => {
      const time = new Date(item.createdAt).getTime()
      return Number.isFinite(time) && time >= previousStart && time <= previousEnd && caseMatchesDimensions(item)
    })
    : []
  const filteredAlerts = alerts.filter((item) => {
    if (!inPeriod(item.submittedAt)) return false
    if (appliedFilters.ward && item.ward !== appliedFilters.ward) return false
    if (appliedFilters.district && item.district !== appliedFilters.district) return false
    if (appliedFilters.province && districtProvince.get(item.district) !== appliedFilters.province) return false
    if (appliedFilters.category && !alertConcerns(item).includes(appliedFilters.category)) return false
    if (appliedFilters.risk && item.riskLevel.toUpperCase() !== appliedFilters.risk) return false
    if (appliedFilters.sex && item.sex !== appliedFilters.sex) return false
    return ageMatches(item.age)
  })
  const closedCases = filteredCases.filter((item) => ["Approved", "Closed"].includes(item.closureStatus || "") || item.status.toLowerCase().includes("closed"))
  const activeCases = filteredCases.filter((item) => !closedCases.some((closed) => closed.id === item.id) && item.status !== "Draft")
  const highRiskCases = activeCases.filter((item) => ["HIGH", "CRITICAL"].includes(item.riskLevel.toUpperCase()))
  const overdueCases = activeCases.filter((item) => item.assessmentSlaStatus === "Overdue" || Boolean(item.assessmentDueAt && new Date(item.assessmentDueAt).getTime() < Date.now() && !item.assessmentCompletedAt))
  const allocationDelays = filteredCases.map((item) => item.allocationDelaySeconds).filter((value): value is number => value != null)
  const averageAllocationSeconds = allocationDelays.length ? Math.round(allocationDelays.reduce((sum, value) => sum + value, 0) / allocationDelays.length) : null
  const averageCaseAgeDays = activeCases.length ? Math.round(activeCases.reduce((sum, item) => sum + Math.max(0, Date.now() - new Date(item.createdAt).getTime()) / 86400000, 0) / activeCases.length) : null
  const belowTarget = config.performanceEntity === "province" || config.performanceEntity === "district"
    ? groupAnalyticsCases(filteredCases, config.performanceEntity, districts).filter((group) => group.overdue > 0).length
    : overdueCases.length
  const averageMetric = config.scope === "officer"
    ? (averageCaseAgeDays == null ? "—" : `${averageCaseAgeDays}d`)
    : (averageAllocationSeconds == null ? "—" : formatDuration(averageAllocationSeconds))
  const previousClosed = previousCases.filter(caseIsClosed).length
  const previousHighRisk = previousCases.filter((item) => ["HIGH", "CRITICAL"].includes(item.riskLevel.toUpperCase())).length
  const previousOverdue = previousCases.filter(caseIsOverdue).length
  const comparisonNote = (current: number, previous: number, fallback: string) => {
    if (periodLength == null) return fallback
    if (!previous) return current ? "New activity vs previous period" : "No change from previous period"
    const change = Math.round((current - previous) / previous * 100)
    return `${change > 0 ? "▲" : change < 0 ? "▼" : "•"} ${Math.abs(change)}% from previous period`
  }
  const kpis = [
    { label: "New Cases", value: filteredCases.length, icon: Inbox, tone: "blue", note: comparisonNote(filteredCases.length, previousCases.length, "Created in selected period") },
    { label: "Active Cases", value: activeCases.length, icon: BriefcaseBusiness, tone: "teal", note: "Currently being managed" },
    { label: "High-Risk Cases", value: highRiskCases.length, icon: ShieldAlert, tone: highRiskCases.length ? "red" : "teal", note: "High or critical risk" },
    { label: "Overdue Cases", value: overdueCases.length, icon: Clock3, tone: overdueCases.length ? "amber" : "teal", note: overdueCases.length ? "Outside required timeline" : "Within required timelines" },
  ]

  const categories = Array.from(new Set([...cases.map((item) => item.concern), ...alerts.flatMap(alertConcerns)])).filter(Boolean).sort()
  const wards = Array.from(new Set([...cases.map((item) => item.ward), ...alerts.map((item) => item.ward)])).filter(Boolean).sort()
  const districtOptions = Array.from(new Set(cases.map((item) => item.district))).filter(Boolean).sort()
  const provinceOptions = Array.from(new Set(districts.map((item) => item.provinceName))).filter(Boolean).sort()
  const officers = Array.from(new Set(users.filter((item) => item.profile.role === "DSDO").map(userDisplayName))).filter(Boolean).sort()
  const statuses = Array.from(new Set(cases.flatMap((item) => [item.status, item.closureStatus || ""]))).filter(Boolean).sort()
  const visibleDistrictOptions = draftFilters.province ? districtOptions.filter((name) => districtProvince.get(name) === draftFilters.province) : districtOptions
  const visibleWardOptions = draftFilters.district
    ? Array.from(new Set([...cases.filter((item) => item.district === draftFilters.district).map((item) => item.ward), ...alerts.filter((item) => item.district === draftFilters.district).map((item) => item.ward)])).filter(Boolean).sort()
    : wards
  const visibleOfficerOptions = draftFilters.district
    ? Array.from(new Set(users.filter((item) => item.profile.role === "DSDO" && item.profile.districtName === draftFilters.district).map(userDisplayName))).filter(Boolean).sort()
    : officers

  function updateDraft(key: keyof AnalyticsFilters, value: string) {
    if (key === "start" || key === "end") setDraftPeriodPreset("")
    setDraftFilters((current) => ({ ...current, [key]: value, ...(key === "province" ? { district: "", ward: "" } : key === "district" ? { ward: "" } : {}) }))
  }
  function openFilterDrawer() {
    setDraftFilters(appliedFilters)
    setDraftPeriodPreset(appliedPeriodPreset)
    setFilterDrawerOpen(true)
  }
  function applyFilters() {
    setAppliedFilters(draftFilters)
    setAppliedPeriodPreset(draftPeriodPreset)
    setStartDate(draftFilters.start)
    setEndDate(draftFilters.end)
    setDetailPage(1)
    setFilterDrawerOpen(false)
  }
  function resetFilters() {
    const next = { ...emptyFilters, start: "", end: "" }
    setDraftFilters(next)
    setAppliedFilters(next)
    setDraftPeriodPreset("")
    setAppliedPeriodPreset("")
    setStartDate("")
    setEndDate("")
    setDetailPage(1)
  }
  function resetDraftFilters() {
    setDraftFilters({ ...emptyFilters, start: "", end: "" })
    setDraftPeriodPreset("")
  }
  function applyPreset(months: number | "year", label: string) {
    const now = new Date()
    const start = months === "year" ? new Date(now.getFullYear(), 0, 1) : new Date(now.getFullYear(), now.getMonth() - months + 1, 1)
    setDraftFilters((current) => ({ ...current, start: isoDateFromLocalDate(start), end: isoDateFromLocalDate(now) }))
    setDraftPeriodPreset(label)
  }
  function exportAnalyticsCsv() {
    const rows = [["Case", "Child", "District", "Ward", "Category", "Risk", "Status", "Officer"], ...filteredCases.map((item) => [item.id, item.childName, item.district, item.ward, item.concern, item.riskLevel, item.status, item.allocatedOfficer || "Unassigned"])]
    const csv = rows.map((row) => row.map((value) => `"${`${value}`.replace(/"/g, "\"\"")}"`).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `ncms-analytics-${isoDateFromLocalDate(new Date())}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const trendRows = analyticsTrendRows(filteredCases, appliedFilters.start, appliedFilters.end)
  const progression = analyticsProgression(filteredAlerts, filteredCases)
  const riskRows = analyticsRiskRows(activeCases)
  const compliance = analyticsCompliance(filteredCases)
  const processing = analyticsProcessingTimes(filteredCases)
  const geography = analyticsGeography(filteredCases, config.geographyGroupBy, districts)
  const categoryRows = analyticsCategoryRows(filteredCases)
  const performanceRows = config.performanceEntity === "self" ? [] : groupAnalyticsCases(filteredCases, config.performanceEntity, districts, users)

  const detailRows = filteredCases.filter((item) => `${item.id} ${item.childName} ${item.concern} ${item.district} ${item.allocatedOfficer || ""}`.toLowerCase().includes(detailSearch.toLowerCase()))
    .sort((a, b) => detailSort === "risk" ? riskRank(b.riskLevel) - riskRank(a.riskLevel) : detailSort === "oldest" ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const detailPageCount = Math.max(1, Math.ceil(detailRows.length / 10))
  const safeDetailPage = Math.min(detailPage, detailPageCount)
  const visibleDetails = detailRows.slice((safeDetailPage - 1) * 10, safeDetailPage * 10)
  const activeFilterChips: Array<{ key: keyof AnalyticsFilters | "period"; label: string }> = []
  if (appliedPeriodPreset) {
    activeFilterChips.push({ key: "period", label: appliedPeriodPreset })
  } else {
    if (appliedFilters.start) activeFilterChips.push({ key: "start", label: `From ${appliedFilters.start}` })
    if (appliedFilters.end) activeFilterChips.push({ key: "end", label: `To ${appliedFilters.end}` })
  }
  const chipLabels: Partial<Record<keyof AnalyticsFilters, string>> = {
    ward: "Ward",
    officer: "Officer",
    province: "Province",
    district: "District",
    category: "Category",
    risk: "Risk",
    status: "Status",
    sex: "Sex",
    ageGroup: "Age",
  }
  ;(Object.keys(chipLabels) as Array<keyof AnalyticsFilters>).forEach((key) => {
    if (appliedFilters[key]) activeFilterChips.push({ key, label: `${chipLabels[key]}: ${appliedFilters[key]}` })
  })
  function removeAppliedFilter(key: keyof AnalyticsFilters | "period") {
    const next = { ...appliedFilters }
    if (key === "period") {
      next.start = ""
      next.end = ""
      setAppliedPeriodPreset("")
      setStartDate("")
      setEndDate("")
    } else {
      next[key] = ""
      if (key === "start" || key === "end") {
        setAppliedPeriodPreset("")
        if (key === "start") setStartDate("")
        if (key === "end") setEndDate("")
      }
    }
    setAppliedFilters(next)
    setDraftFilters(next)
    setDetailPage(1)
  }

  return (
    <div className="space-y-5 text-[#263747]">
      <section className="rounded-lg border border-[#d8dee8] bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><h1 className="text-2xl font-bold">Analytics</h1><p className="mt-1 text-sm font-semibold text-[#64748b]">Case management performance and trend analysis</p></div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-[#ecfdf5] px-3 py-1.5 text-xs font-bold text-[#0f766e]">{config.scopeLabel}</span>
            <button className="inline-flex h-10 items-center gap-2 rounded-md border border-[#d8dee8] bg-white px-4 text-sm font-bold text-[#263747] hover:border-[#0f766e] hover:text-[#0f766e]" onClick={openFilterDrawer}><Filter className="h-4 w-4" />Filters{activeFilterChips.length > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-[#0f766e] px-1.5 py-0.5 text-[11px] leading-4 text-white">{activeFilterChips.length}</span>}</button>
            <button className="inline-flex h-10 items-center gap-2 rounded-md border border-[#0f766e] bg-white px-4 text-sm font-bold text-[#0f766e]" onClick={exportAnalyticsCsv}><FileText className="h-4 w-4" />Export Analytics</button>
          </div>
        </div>
      </section>

      {activeFilterChips.length > 0 && <section className="flex flex-wrap items-center gap-2" aria-label="Active analytics filters">{activeFilterChips.map((chip) => <button key={chip.key} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#b9ddd7] bg-[#eef9f6] px-3 text-xs font-bold text-[#0f766e]" onClick={() => removeAppliedFilter(chip.key)}>{chip.label}<X className="h-3.5 w-3.5" /></button>)}<button className="ml-1 text-xs font-bold text-[#64748b] underline decoration-[#94a3b8] underline-offset-4 hover:text-[#0f766e]" onClick={resetFilters}>Clear all</button></section>}

      {error && <AnalyticsErrorState message="Unable to load the latest analytics aggregation." retry={onRetry} />}
      {loading && !data ? <AnalyticsSkeleton /> : <>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{kpis.map((item) => <AnalyticsKpiCard key={item.label} {...item} />)}</section>

        <section className="grid gap-5 xl:grid-cols-12">
          <div className="xl:col-span-8"><AnalyticsPanel title="Case Trends" subtitle="New and closed cases over the selected period">{trendRows.length ? <ReactECharts option={analyticsTrendOption(trendRows)} style={{ height: 260, width: "100%" }} notMerge /> : <AnalyticsEmptyState message="No case trend data is available for the selected period." action="Reset filters" onAction={resetFilters} />}</AnalyticsPanel></div>
          <div className="xl:col-span-4"><AnalyticsPanel title="Risk Distribution" subtitle="Active cases by current risk level">{riskRows.some((item) => item.value > 0) ? <ReactECharts option={analyticsRiskOption(riskRows, activeCases.length)} style={{ height: 260, width: "100%" }} notMerge /> : <AnalyticsEmptyState message="No assessed risk information is available yet." />}</AnalyticsPanel></div>
        </section>

        <AnalyticsPanel title="Case Progression" subtitle="Current cases across the case-management lifecycle">{filteredCases.length || filteredAlerts.length ? <CaseProgressionView rows={progression} /> : <AnalyticsEmptyState message="No case progression data is available for the selected period." />}</AnalyticsPanel>

        <AnalyticsPanel title="Workflow Performance" subtitle="Completion against required case-management timelines">{filteredCases.length ? <ComplianceView rows={compliance} /> : <AnalyticsEmptyState message="No workflow performance data is available for the selected period." />}</AnalyticsPanel>

        <div className="flex justify-end">
          <button className="inline-flex items-center gap-2 rounded-md px-2 py-2 text-sm font-bold text-[#0f766e] hover:bg-[#eef9f6]" onClick={() => setDetailsOpen((value) => !value)}>View Detailed Analytics <ArrowRight className={`h-4 w-4 transition ${detailsOpen ? "rotate-90" : ""}`} /></button>
        </div>

        {detailsOpen && <section className="space-y-5 border-t border-[#d8dee8] pt-5" aria-label="Detailed analytics">
          <section className="grid gap-5 xl:grid-cols-12">
            <div className="xl:col-span-7"><AnalyticsPanel title={config.geographyLabel} subtitle="Geographic distribution within your authorised scope">{geography.length ? <><ReactECharts option={analyticsHorizontalBarOption(showAllLocations ? geography : geography.slice(0, 10), "#0f766e")} style={{ height: Math.max(280, Math.min(showAllLocations ? geography.length : 10, geography.length) * 34), width: "100%" }} notMerge />{geography.length > 10 && <button className="mt-2 text-sm font-bold text-[#0f766e]" onClick={() => setShowAllLocations((value) => !value)}>{showAllLocations ? "Show top 10" : `View all ${geography.length} locations`}</button>}</> : <AnalyticsEmptyState message="No geographic data is available for the selected period." />}</AnalyticsPanel></div>
            <div className="xl:col-span-5"><AnalyticsPanel title="Average Processing Time" subtitle="Time between major workflow stages">{processing.some((item) => item.seconds != null) ? <ProcessingTimeView rows={processing} /> : <AnalyticsEmptyState message="No completed workflow stages are available for processing-time analysis." />}</AnalyticsPanel></div>
          </section>
          <AnalyticsPanel title="Case Categories" subtitle="Distribution by primary case category">{categoryRows.length ? <ReactECharts option={analyticsHorizontalBarOption(categoryRows, "#0a4f57", true)} style={{ height: Math.max(280, categoryRows.length * 34), width: "100%" }} notMerge /> : <AnalyticsEmptyState message="No case category data is available for the selected period." />}</AnalyticsPanel>
          <RolePerformancePanel config={config} rows={performanceRows} cases={filteredCases} compliance={compliance} />
          <section ref={detailPanelRef} className="overflow-hidden rounded-lg border border-[#d8dee8] bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 px-5 py-4"><div><h2 className="text-lg font-bold">Detailed Breakdown</h2><p className="mt-1 text-sm font-semibold text-[#64748b]">{filteredCases.length} cases in current view</p></div></div>
            <div className="border-t border-[#edf0f4] p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2"><input className={`${inputClass} w-72`} placeholder="Search cases…" value={detailSearch} onChange={(event) => { setDetailSearch(event.target.value); setDetailPage(1) }} /><select className={`${inputClass} w-44`} value={detailSort} onChange={(event) => setDetailSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="risk">Highest risk first</option></select></div></div><DetailedAnalyticsTable rows={visibleDetails} /><div className="mt-4 flex items-center justify-between text-sm font-semibold text-[#64748b]"><span>Page {safeDetailPage} of {detailPageCount}</span><div className="flex gap-2"><button className="rounded-md border border-[#d8dee8] px-3 py-2 disabled:opacity-40" disabled={safeDetailPage <= 1} onClick={() => setDetailPage((page) => Math.max(1, page - 1))}>Previous</button><button className="rounded-md border border-[#d8dee8] px-3 py-2 disabled:opacity-40" disabled={safeDetailPage >= detailPageCount} onClick={() => setDetailPage((page) => Math.min(detailPageCount, page + 1))}>Next</button></div></div></div>
          </section>
        </section>}
      </>}
      <AnalyticsFilterDrawer open={filterDrawerOpen} close={() => setFilterDrawerOpen(false)} config={config} draft={draftFilters} updateDraft={updateDraft} apply={applyFilters} reset={resetDraftFilters} applyPreset={applyPreset} activePreset={draftPeriodPreset} options={{ wards: visibleWardOptions, officers: visibleOfficerOptions, districts: visibleDistrictOptions, provinces: provinceOptions, categories, statuses }} />
    </div>
  )
}

function AnalyticsFilterDrawer({ open, close, config, draft, updateDraft, apply, reset, applyPreset, activePreset, options }: { open: boolean; close: () => void; config: AnalyticsRoleConfig; draft: AnalyticsFilters; updateDraft: (key: keyof AnalyticsFilters, value: string) => void; apply: () => void; reset: () => void; applyPreset: (months: number | "year", label: string) => void; activePreset: string; options: { wards: string[]; officers: string[]; districts: string[]; provinces: string[]; categories: string[]; statuses: string[] } }) {
  if (!open) return null
  const presets: Array<{ label: string; value: number | "year" }> = [{ label: "This Month", value: 1 }, { label: "Last 3 Months", value: 3 }, { label: "Last 6 Months", value: 6 }, { label: "This Year", value: "year" }]
  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <button className="absolute inset-0 cursor-default bg-[#102033]/45" aria-label="Close analytics filters" onClick={close} />
      <aside className="absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl sm:max-w-[430px]" role="dialog" aria-modal="true" aria-labelledby="analytics-filter-title">
        <div className="flex items-center justify-between border-b border-[#d8dee8] px-5 py-4">
          <div><h2 id="analytics-filter-title" className="text-xl font-bold text-[#263747]">Filters</h2><p className="mt-1 text-sm font-semibold text-[#64748b]">Refine the analytics in your authorised scope.</p></div>
          <button className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] text-[#64748b] hover:bg-[#f8fafc]" onClick={close} aria-label="Close filters"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <AnalyticsFilterSection title="Period">
            <div className="grid grid-cols-2 gap-2">{presets.map((preset) => <button key={preset.label} className={`rounded-md border px-3 py-2.5 text-sm font-bold ${activePreset === preset.label ? "border-[#0f766e] bg-[#e7f6f3] text-[#0f766e]" : "border-[#d8dee8] bg-white text-[#50617a] hover:border-[#0f766e]"}`} onClick={() => applyPreset(preset.value, preset.label)}>{preset.label}</button>)}</div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="From" required={false}><input className={inputClass} type="date" value={draft.start} onChange={(event) => updateDraft("start", event.target.value)} /></Field><Field label="To" required={false}><input className={inputClass} type="date" value={draft.end} onChange={(event) => updateDraft("end", event.target.value)} /></Field></div>
          </AnalyticsFilterSection>
          <AnalyticsFilterSection title="Location and Responsibility">
            <div className="grid gap-4">{config.filters.includes("province") && <AnalyticsSelect label="Province" value={draft.province} options={options.provinces} onChange={(value) => updateDraft("province", value)} />}{config.filters.includes("district") && <AnalyticsSelect label="District" value={draft.district} options={options.districts} onChange={(value) => updateDraft("district", value)} />}{config.filters.includes("ward") && <AnalyticsSelect label="Ward" value={draft.ward} options={options.wards} onChange={(value) => updateDraft("ward", value)} />}{config.filters.includes("officer") && <AnalyticsSelect label="Officer" value={draft.officer} options={options.officers} onChange={(value) => updateDraft("officer", value)} />}</div>
          </AnalyticsFilterSection>
          <AnalyticsFilterSection title="Case Details">
            <div className="grid gap-4"><AnalyticsSelect label="Case category" value={draft.category} options={options.categories} onChange={(value) => updateDraft("category", value)} /><AnalyticsSelect label="Risk level" value={draft.risk} options={["CRITICAL", "HIGH", "MEDIUM", "LOW", "PENDING"]} onChange={(value) => updateDraft("risk", value)} /><AnalyticsSelect label="Case status" value={draft.status} options={options.statuses} onChange={(value) => updateDraft("status", value)} /><AnalyticsSelect label="Sex" value={draft.sex} options={["Male", "Female", "Unknown"]} onChange={(value) => updateDraft("sex", value)} /><AnalyticsSelect label="Age group" value={draft.ageGroup} options={["0-5", "6-12", "13-17", "18+", "Unknown"]} onChange={(value) => updateDraft("ageGroup", value)} /></div>
          </AnalyticsFilterSection>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-[#d8dee8] bg-white px-5 py-4"><button className="h-11 rounded-md border border-[#d8dee8] text-sm font-bold text-[#50617a]" onClick={reset}>Reset Filters</button><button className="h-11 rounded-md bg-[#0f766e] text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={Boolean(draft.start && draft.end && draft.start > draft.end)} onClick={apply}>Apply Filters</button></div>
      </aside>
    </div>,
    document.body,
  )
}

function AnalyticsFilterSection({ title, children }: { title: string; children: ReactNode }) {
  return <section><h3 className="mb-3 border-b border-[#edf0f4] pb-2 text-sm font-bold uppercase tracking-wide text-[#263747]">{title}</h3>{children}</section>
}

function AnalyticsSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <Field label={label} required={false}><select className={inputClass} value={value} onChange={(event) => onChange(event.target.value)}><option value="">All</option>{options.map((item) => <option key={item}>{item}</option>)}</select></Field>
}

function AnalyticsKpiCard({ label, value, icon: Icon, tone, note }: { label: string; value: string | number; icon: ElementType; tone: string; note: string }) {
  const styles: Record<string, string> = { teal: "bg-[#ecfdf5] text-[#0f766e]", green: "bg-[#eaf8ef] text-[#16834a]", blue: "bg-[#edf6ff] text-[#2e6fa3]", red: "bg-[#fff1f0] text-[#b42318]", amber: "bg-[#fff8e7] text-[#a05b16]" }
  return <article className="flex min-h-[126px] flex-col rounded-lg border border-[#d8dee8] bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="text-sm font-bold leading-tight text-[#50617a]">{label}</div><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${styles[tone] || styles.blue}`}><Icon className="h-4 w-4" /></span></div><div className="mt-2 text-3xl font-bold leading-none text-[#263747]">{value}</div><div className="mt-auto pt-2 text-xs font-semibold text-[#64748b]">{note}</div></article>
}

function AnalyticsPanel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <section className="h-full rounded-lg border border-[#d8dee8] bg-white p-5 shadow-sm"><div className="mb-4"><h2 className="text-lg font-bold text-[#263747]">{title}</h2><p className="mt-1 text-sm font-semibold text-[#64748b]">{subtitle}</p></div>{children}</section>
}

function DownloadPngButton({ targetRef, title, compact = false }: { targetRef: { current: HTMLElement | null }; title: string; compact?: boolean }) {
  const [downloading, setDownloading] = useState(false)
  async function downloadPng() {
    if (!targetRef.current || downloading) return
    setDownloading(true)
    try {
      const dataUrl = await toPng(targetRef.current, {
        backgroundColor: "#ffffff",
        cacheBust: true,
        pixelRatio: 2,
        filter: (node) => !(node instanceof HTMLElement && node.dataset.pngControl === "true"),
      })
      const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "analytics"
      const link = document.createElement("a")
      link.download = `ncms-${safeTitle}-${isoDateFromLocalDate(new Date())}.png`
      link.href = dataUrl
      link.click()
    } catch (error) {
      console.error("Unable to download analytics PNG", error)
      window.alert("The analytics image could not be downloaded. Please try again.")
    } finally {
      setDownloading(false)
    }
  }
  return <button type="button" data-png-control="true" className={`grid shrink-0 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#64748b] hover:border-[#0f766e] hover:text-[#0f766e] disabled:cursor-wait disabled:opacity-50 ${compact ? "h-7 w-7" : "h-9 w-9"}`} title={`Download ${title} as PNG`} aria-label={`Download ${title} as PNG`} disabled={downloading} onClick={() => void downloadPng()}><Download className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} /></button>
}

function AnalyticsEmptyState({ message, action, onAction }: { message: string; action?: string; onAction?: () => void }) {
  return <div className="grid min-h-52 place-items-center rounded-md border border-dashed border-[#d8dee8] bg-[#f8fafc] p-6 text-center"><div><BarChart3 className="mx-auto h-9 w-9 text-[#94a3b8]" /><p className="mt-3 text-sm font-semibold text-[#64748b]">{message}</p>{action && onAction && <button className="mt-3 text-sm font-bold text-[#0f766e]" onClick={onAction}>{action}</button>}</div></div>
}

function AnalyticsErrorState({ message, retry }: { message: string; retry: () => Promise<void> }) {
  return <div className="flex items-center justify-between rounded-lg border border-[#f4b4ac] bg-[#fff7f5] p-4 text-sm font-semibold text-[#b42318]"><span>{message}</span><button className="font-bold underline" onClick={() => void retry()}>Retry</button></div>
}

function AnalyticsSkeleton() {
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-32 animate-pulse rounded-lg bg-[#e8edf2]" />)}</div><div className="h-72 animate-pulse rounded-lg bg-[#e8edf2]" /></div>
}

function KeyInsightsPanel({ insights }: { insights: Array<{ text: string; tone: "positive" | "warning" | "neutral" }> }) {
  const panelRef = useRef<HTMLElement>(null)
  return <section ref={panelRef} className="rounded-lg border border-[#cce5df] bg-[#f4fbf8] px-5 py-4"><div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><InfoIcon className="h-5 w-5 text-[#0f766e]" /><h2 className="text-base font-bold text-[#263747]">Key Insights</h2></div><DownloadPngButton targetRef={panelRef} title="Key Insights" /></div><div className="grid gap-2 lg:grid-cols-2">{insights.map((item, index) => <div key={`${item.text}-${index}`} className="flex gap-2 text-sm font-semibold text-[#50617a]"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.tone === "warning" ? "bg-[#d97706]" : item.tone === "positive" ? "bg-[#16834a]" : "bg-[#2e6fa3]"}`} />{item.text}</div>)}</div></section>
}

type AnalyticsGroupRow = {
  name: string
  active: number
  highRisk: number
  overdue: number
  assessments: number
  assessmentCompliance: number
  monitoringCompliance: number
  workload: "Low" | "Balanced" | "High" | "Critical"
}

function caseIsClosed(item: CaseRecord) {
  return ["Approved", "Closed"].includes(item.closureStatus || "") || item.status.toLowerCase().includes("closed")
}

function caseIsOverdue(item: CaseRecord) {
  return item.assessmentSlaStatus === "Overdue" || Boolean(item.assessmentDueAt && new Date(item.assessmentDueAt).getTime() < Date.now() && !item.assessmentCompletedAt)
}

function riskRank(value: string) {
  return ({ CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, PENDING: 1 } as Record<string, number>)[value.toUpperCase()] || 0
}

function groupAnalyticsCases(cases: CaseRecord[], entity: "officer" | "district" | "province", districts: DistrictOption[], users: ApiUser[] = []) {
  const districtProvince = new Map(districts.map((district) => [district.name, district.provinceName]))
  const officerNames = entity === "officer" ? users.filter((item) => item.profile.role === "DSDO").map(userDisplayName) : []
  const names = new Set<string>(officerNames)
  cases.forEach((item) => {
    if (entity === "officer") names.add(item.allocatedOfficer || "Unassigned")
    else if (entity === "district") names.add(item.district || "Not captured")
    else names.add(districtProvince.get(item.district) || "Not captured")
  })
  return Array.from(names).filter(Boolean).map((name): AnalyticsGroupRow => {
    const groupCases = cases.filter((item) => entity === "officer" ? (item.allocatedOfficer || "Unassigned") === name : entity === "district" ? (item.district || "Not captured") === name : (districtProvince.get(item.district) || "Not captured") === name)
    const active = groupCases.filter((item) => !caseIsClosed(item) && item.status !== "Draft")
    const highRisk = active.filter((item) => ["HIGH", "CRITICAL"].includes(item.riskLevel.toUpperCase())).length
    const overdue = active.filter(caseIsOverdue).length
    const allocated = groupCases.filter((item) => Boolean(item.allocatedAt))
    const completed = allocated.filter((item) => Boolean(item.assessmentCompletedAt)).length
    const monitored = groupCases.filter((item) => Array.isArray(item.intakeDraft?.monitoring_followups_draft) && item.intakeDraft.monitoring_followups_draft.length > 0).length
    const assessmentCompliance = allocated.length ? Math.round(completed / allocated.length * 100) : 0
    const monitoringCompliance = active.length ? Math.round(monitored / active.length * 100) : 0
    const pressure = active.length + highRisk * 2 + overdue * 3
    const workload = pressure >= 30 ? "Critical" : pressure >= 20 ? "High" : pressure >= 8 ? "Balanced" : "Low"
    return { name, active: active.length, highRisk, overdue, assessments: completed, assessmentCompliance, monitoringCompliance, workload }
  }).sort((a, b) => b.active - a.active || b.overdue - a.overdue || a.name.localeCompare(b.name))
}

function analyticsInsights(cases: CaseRecord[], active: CaseRecord[], closed: CaseRecord[], highRisk: CaseRecord[], overdue: CaseRecord[], config: AnalyticsRoleConfig, districts: DistrictOption[]) {
  const insights: Array<{ text: string; tone: "positive" | "warning" | "neutral" }> = []
  if (overdue.length) insights.push({ text: `${overdue.length} active case${overdue.length === 1 ? "" : "s"} have overdue assessment work and require follow-up.`, tone: "warning" })
  if (highRisk.length) insights.push({ text: `${highRisk.length} of ${active.length || 0} active cases are currently assessed as high or critical risk.`, tone: "warning" })
  if (closed.length) insights.push({ text: `${closed.length} case${closed.length === 1 ? " was" : "s were"} closed within the selected period.`, tone: "positive" })
  const groups = analyticsGeography(cases, config.geographyGroupBy, districts)
  if (groups[0]) insights.push({ text: `${groups[0].name} recorded the highest case volume in this view with ${groups[0].value} case${groups[0].value === 1 ? "" : "s"}.`, tone: "neutral" })
  if (!insights.length) insights.push({ text: "No material exceptions were detected for the selected period.", tone: "positive" })
  return insights.slice(0, 4)
}

function analyticsTrendRows(cases: CaseRecord[], start: string, end: string) {
  const buckets = new Map<string, { period: string; newCases: number; closedCases: number }>()
  const startTime = start ? new Date(`${start}T00:00:00`).getTime() : Math.min(...cases.map((item) => new Date(item.createdAt).getTime()).filter(Number.isFinite))
  const endTime = end ? new Date(`${end}T23:59:59`).getTime() : Math.max(...cases.map((item) => new Date(item.createdAt).getTime()).filter(Number.isFinite))
  const rangeDays = Number.isFinite(startTime) && Number.isFinite(endTime) ? Math.max(1, (endTime - startTime) / 86400000) : 365
  const interval = rangeDays <= 45 ? "daily" : rangeDays <= 180 ? "weekly" : "monthly"
  cases.forEach((item) => {
    const date = new Date(item.createdAt)
    if (Number.isNaN(date.getTime())) return
    let period = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`
    if (interval === "daily") period = isoDateFromLocalDate(date)
    if (interval === "weekly") {
      const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7))
      period = `Week of ${isoDateFromLocalDate(weekStart)}`
    }
    const current = buckets.get(period) || { period, newCases: 0, closedCases: 0 }
    current.newCases += 1
    if (caseIsClosed(item)) current.closedCases += 1
    buckets.set(period, current)
  })
  return Array.from(buckets.values()).sort((a, b) => a.period.localeCompare(b.period))
}

function analyticsTrendOption(rows: Array<{ period: string; newCases: number; closedCases: number }>) {
  return {
    color: ["#0f766e", "#16834a"],
    tooltip: { trigger: "axis" },
    legend: { top: 0, data: ["New cases", "Closed cases"] },
    grid: { left: 42, right: 20, top: 45, bottom: 35 },
    xAxis: { type: "category", boundaryGap: false, data: rows.map((item) => item.period), axisLine: { lineStyle: { color: "#cbd5e1" } } },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: "#edf0f4" } } },
    series: [
      { name: "New cases", type: "line", smooth: true, symbolSize: 7, areaStyle: { opacity: 0.08 }, data: rows.map((item) => item.newCases) },
      { name: "Closed cases", type: "line", smooth: true, symbolSize: 7, data: rows.map((item) => item.closedCases) },
    ],
  }
}

function analyticsProgression(alerts: AlertRecord[], cases: CaseRecord[]) {
  return [
    { label: "Intake", value: cases.length },
    { label: "Screening", value: cases.filter((item) => item.status !== "Draft" || Boolean(item.screeningCompletedAt)).length },
    { label: "Allocation", value: cases.filter((item) => Boolean(item.allocatedAt) || item.status === "Allocated").length },
    { label: "Assessment", value: cases.filter((item) => Boolean(item.assessmentCompletedAt)).length },
    { label: "Care Plan", value: cases.filter((item) => ["Approved", "Approved with Comments"].includes(item.assessmentCarePlanStatus || "")).length },
    { label: "Monitoring", value: cases.filter((item) => Array.isArray(item.intakeDraft?.monitoring_followups_draft) && item.intakeDraft.monitoring_followups_draft.length > 0).length },
    { label: "Closure", value: cases.filter(caseIsClosed).length },
  ]
}

function CaseProgressionView({ rows }: { rows: Array<{ label: string; value: number }> }) {
  return <div className="overflow-x-auto pb-1"><div className="flex min-w-[760px] items-center">{rows.map((item, index) => <Fragment key={item.label}><div className="min-w-24 flex-1 text-center"><div className="text-xs font-bold uppercase tracking-wide text-[#64748b]">{item.label}</div><div className="mt-2 text-2xl font-extrabold text-[#263747]">{item.value}</div></div>{index < rows.length - 1 && <ArrowRight className="h-5 w-5 shrink-0 text-[#94a3b8]" />}</Fragment>)}</div></div>
}

function analyticsRiskRows(cases: CaseRecord[]) {
  const levels = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NOT YET ASSESSED"]
  return levels.map((name) => ({ name: name === "NOT YET ASSESSED" ? "Not yet assessed" : name[0] + name.slice(1).toLowerCase(), value: cases.filter((item) => {
    const risk = item.riskLevel.toUpperCase()
    return name === "NOT YET ASSESSED" ? !["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(risk) : risk === name
  }).length }))
}

function analyticsRiskOption(rows: ReportChartRow[], total: number) {
  return {
    color: ["#b42318", "#d04a2b", "#d99516", "#16834a", "#94a3b8"],
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: { bottom: 0, left: "center" },
    title: { text: `${total}`, subtext: "Active cases", left: "center", top: "40%", textStyle: { color: "#263747", fontSize: 26, fontWeight: 700 }, subtextStyle: { color: "#64748b", fontSize: 12 } },
    series: [{ type: "pie", radius: ["52%", "72%"], center: ["50%", "45%"], label: { show: false }, data: rows }],
  }
}

function percent(numerator: number, denominator: number) {
  return denominator ? Math.round(numerator / denominator * 100) : 0
}

function analyticsCompliance(cases: CaseRecord[]) {
  const screened = cases.filter((item) => item.screeningCompletedAt)
  const allocated = cases.filter((item) => item.allocatedAt)
  const assessmentsDue = cases.filter((item) => item.allocatedAt)
  const carePlans = cases.filter((item) => item.assessmentCompletedAt)
  const monitoringDue = cases.filter((item) => Array.isArray(item.intakeDraft?.monitoring_followups_draft))
  const reviewsDue = cases.filter((item) => item.caseReviewDueAt)
  return [
    { label: "Intake and screening", value: percent(screened.filter((item) => new Date(item.screeningCompletedAt || "").getTime() - new Date(item.createdAt).getTime() <= 48 * 3600000).length, screened.length) },
    { label: "Allocation", value: percent(allocated.filter((item) => (item.allocationDelaySeconds || 0) <= 24 * 3600).length, allocated.length) },
    { label: "Assessment", value: percent(assessmentsDue.filter((item) => Boolean(item.assessmentCompletedAt) && item.assessmentSlaStatus !== "Completed late").length, assessmentsDue.length) },
    { label: "Care plan", value: percent(carePlans.filter((item) => ["Submitted", "Approved", "Approved with Comments"].includes(item.assessmentCarePlanStatus || "")).length, carePlans.length) },
    { label: "Monitoring", value: percent(monitoringDue.filter((item) => Boolean((item.intakeDraft?.monitoring_followups_draft as unknown[])?.length)).length, monitoringDue.length) },
    { label: "Case review", value: percent(reviewsDue.filter((item) => ["Completed", "Approved"].includes(item.caseReviewStatus || "")).length, reviewsDue.length) },
  ]
}

function ComplianceView({ rows }: { rows: Array<{ label: string; value: number }> }) {
  return <div className="grid gap-x-8 gap-y-3 lg:grid-cols-2">{rows.map((item) => <div key={item.label}><div className="mb-1 flex justify-between text-sm font-bold"><span className="text-[#50617a]">{item.label}</span><span className={item.value >= 80 ? "text-[#16834a]" : item.value >= 60 ? "text-[#a05b16]" : "text-[#b42318]"}>{item.value}%</span></div><div className="h-2 overflow-hidden rounded-full bg-[#e8edf2]"><div className={`h-full rounded-full ${item.value >= 80 ? "bg-[#16834a]" : item.value >= 60 ? "bg-[#d99516]" : "bg-[#b42318]"}`} style={{ width: `${item.value}%` }} /></div></div>)}</div>
}

function analyticsProcessingTimes(cases: CaseRecord[]) {
  const allocation = cases.map((item) => item.allocationDelaySeconds).filter((value): value is number => value != null)
  const assessment = cases.filter((item) => item.allocatedAt && item.assessmentCompletedAt).map((item) => (new Date(item.assessmentCompletedAt || "").getTime() - new Date(item.allocatedAt || "").getTime()) / 1000).filter((value) => value >= 0)
  const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null
  return [
    { label: "Alert to intake", seconds: null, target: null },
    { label: "Intake to screening", seconds: null, target: 48 * 3600 },
    { label: "Approval to allocation", seconds: average(allocation), target: 24 * 3600 },
    { label: "Allocation to assessment", seconds: average(assessment), target: 7 * 86400 },
    { label: "Assessment to care plan", seconds: null, target: null },
    { label: "Case opening to closure", seconds: null, target: null },
  ]
}

function ProcessingTimeView({ rows }: { rows: Array<{ label: string; seconds: number | null; target: number | null }> }) {
  return <div className="divide-y divide-[#edf0f4]">{rows.map((item) => { const status = item.seconds == null || item.target == null ? "Unavailable" : item.seconds <= item.target ? "Within target" : item.seconds <= item.target * 1.15 ? "Near target" : "Outside target"; return <div key={item.label} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"><div><div className="text-sm font-bold text-[#50617a]">{item.label}</div><div className={`mt-1 text-xs font-semibold ${status === "Within target" ? "text-[#16834a]" : status === "Outside target" ? "text-[#b42318]" : status === "Near target" ? "text-[#a05b16]" : "text-[#94a3b8]"}`}>{status}</div></div><span className="text-base font-bold text-[#263747]">{item.seconds == null ? "—" : formatDuration(item.seconds)}</span></div> })}</div>
}

function analyticsGeography(cases: CaseRecord[], groupBy: "ward" | "district" | "province", districts: DistrictOption[]) {
  const districtProvince = new Map(districts.map((district) => [district.name, district.provinceName]))
  const counts = new Map<string, number>()
  cases.forEach((item) => {
    const key = groupBy === "ward" ? item.ward : groupBy === "district" ? item.district : districtProvince.get(item.district) || "Not captured"
    counts.set(key || "Not captured", (counts.get(key || "Not captured") || 0) + 1)
  })
  return Array.from(counts, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

function analyticsCategoryRows(cases: CaseRecord[]) {
  const counts = new Map<string, number>()
  cases.forEach((item) => counts.set(item.concern || "Other", (counts.get(item.concern || "Other") || 0) + 1))
  return Array.from(counts, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10)
}

function analyticsHorizontalBarOption(rows: ReportChartRow[], color: string, showPercentage = false) {
  const total = rows.reduce((sum, item) => sum + item.value, 0)
  return {
    color: [color],
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (params: Array<{ name: string; value: number }>) => `${params[0]?.name}: ${params[0]?.value}${showPercentage && total ? ` (${Math.round(params[0].value / total * 100)}%)` : ""}` },
    grid: { left: 10, right: 45, top: 5, bottom: 15, containLabel: true },
    xAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: "#edf0f4" } } },
    yAxis: { type: "category", inverse: true, data: rows.map((item) => item.name), axisLine: { show: false }, axisTick: { show: false } },
    series: [{ type: "bar", barMaxWidth: 18, data: rows.map((item) => item.value), label: { show: true, position: "right", formatter: (params: { value: number }) => showPercentage && total ? `${params.value}  ${Math.round(params.value / total * 100)}%` : `${params.value}` }, itemStyle: { borderRadius: [0, 5, 5, 0] } }],
  }
}

function RolePerformancePanel({ config, rows, cases, compliance }: { config: AnalyticsRoleConfig; rows: AnalyticsGroupRow[]; cases: CaseRecord[]; compliance: Array<{ label: string; value: number }> }) {
  const title = config.performanceEntity === "self" ? "My Performance" : config.performanceEntity === "officer" ? "Officer Workload and Performance" : config.performanceEntity === "district" ? "District Performance" : "Provincial Performance"
  if (config.performanceEntity === "self") {
    const monitored = cases.filter((item) => Array.isArray(item.intakeDraft?.monitoring_followups_draft) && item.intakeDraft.monitoring_followups_draft.length > 0).length
    const values = [{ label: "Active caseload", value: cases.filter((item) => !caseIsClosed(item) && item.status !== "Draft").length }, { label: "Assessments completed", value: cases.filter((item) => item.assessmentCompletedAt).length }, { label: "Monitoring visits recorded", value: monitored }, { label: "Cases closed", value: cases.filter(caseIsClosed).length }, { label: "Overdue tasks", value: cases.filter(caseIsOverdue).length }, { label: "Completion compliance", value: `${Math.round(compliance.reduce((sum, item) => sum + item.value, 0) / compliance.length)}%` }]
    return <AnalyticsPanel title={title} subtitle="Your case management activity within the selected period"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{values.map((item) => <div key={item.label} className="rounded-md border border-[#edf0f4] bg-[#f8fafc] p-3"><div className="text-xs font-bold text-[#64748b]">{item.label}</div><div className="mt-2 text-2xl font-bold text-[#263747]">{item.value}</div></div>)}</div></AnalyticsPanel>
  }
  return <AnalyticsPanel title={title} subtitle="Workload, risk pressure and compliance within your authorised scope">{rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="bg-[#f8fafc] text-[#50617a]"><tr>{[config.performanceEntity === "officer" ? "Officer" : config.performanceEntity === "district" ? "District" : "Province", "Active Cases", "High-Risk", "Overdue", "Assessments Completed", "Assessment Compliance", "Monitoring Compliance", "Workload"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.name}><td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#263747]">{row.name}</td><td className="border-b border-[#edf0f4] px-3 py-3">{row.active}</td><td className="border-b border-[#edf0f4] px-3 py-3">{row.highRisk}</td><td className="border-b border-[#edf0f4] px-3 py-3">{row.overdue}</td><td className="border-b border-[#edf0f4] px-3 py-3">{row.assessments}</td><td className="border-b border-[#edf0f4] px-3 py-3"><MiniProgress value={row.assessmentCompliance} /></td><td className="border-b border-[#edf0f4] px-3 py-3"><MiniProgress value={row.monitoringCompliance} /></td><td className="border-b border-[#edf0f4] px-3 py-3"><WorkloadBadge value={row.workload} /></td></tr>)}</tbody></table></div> : <AnalyticsEmptyState message={`No ${config.performanceEntity === "officer" ? "officers are assigned within this scope" : "performance data is available for the selected period"}.`} />}</AnalyticsPanel>
}

function MiniProgress({ value }: { value: number }) {
  return <div className="flex min-w-28 items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-[#e8edf2]"><div className={`h-full ${value >= 80 ? "bg-[#16834a]" : value >= 60 ? "bg-[#d99516]" : "bg-[#b42318]"}`} style={{ width: `${value}%` }} /></div><span className="w-9 text-xs font-bold">{value}%</span></div>
}

function WorkloadBadge({ value }: { value: AnalyticsGroupRow["workload"] }) {
  const style = value === "Critical" ? "bg-[#fee4e2] text-[#b42318]" : value === "High" ? "bg-[#fff4d6] text-[#a05b16]" : value === "Balanced" ? "bg-[#e7f6f3] text-[#0f766e]" : "bg-[#edf6ff] text-[#2e6fa3]"
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${style}`}>{value}</span>
}

function DetailedAnalyticsTable({ rows }: { rows: CaseRecord[] }) {
  return <div className="overflow-x-auto rounded-md border border-[#d8dee8]"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[#f8fafc] text-[#50617a]"><tr>{["Case", "Child", "District / Ward", "Category", "Risk", "Status", "Officer", "Created"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead><tbody>{rows.length ? rows.map((item) => <tr key={item.id}><td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#30528c]">{item.id}</td><td className="border-b border-[#edf0f4] px-3 py-3">{item.childName}</td><td className="border-b border-[#edf0f4] px-3 py-3">{item.district} / {item.ward}</td><td className="border-b border-[#edf0f4] px-3 py-3">{item.concern}</td><td className="border-b border-[#edf0f4] px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${["HIGH", "CRITICAL"].includes(item.riskLevel.toUpperCase()) ? "bg-[#fee4e2] text-[#b42318]" : "bg-[#e7f6f3] text-[#0f766e]"}`}>{item.riskLevel}</span></td><td className="border-b border-[#edf0f4] px-3 py-3">{item.status}</td><td className="border-b border-[#edf0f4] px-3 py-3">{item.allocatedOfficer || "Unassigned"}</td><td className="border-b border-[#edf0f4] px-3 py-3">{formatWorkflowDateTime(item.createdAt)}</td></tr>) : <tr><td colSpan={8} className="px-4 py-8 text-center font-semibold text-[#64748b]">No cases match the current filters.</td></tr>}</tbody></table></div>
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
  const alertCcwNames = Array.from(new Set(scopedAlerts.filter((alert) => alert.reporterType === "CCW").map((alert) => submittedByLabel(alert)).filter(Boolean))).sort()
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
      servicesReceived: "Not captured",
      outstanding: alert.actionPlan || alert.description || "Not captured",
      servicesReferred: "Not captured",
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

function AllegedPerpetratorTable({ records, onEdit, onRemove }: { records: AllegedPerpetratorDraft[]; onEdit?: (index: number) => void; onRemove?: (index: number) => void }) {
  const canManage = Boolean(onEdit || onRemove)
  return (
    <div className="overflow-hidden rounded-md border border-[#d8dee8] bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1450px] border-collapse text-left text-sm">
          <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Accused name", "Relationship", "Sex", "Police referral", "Police referral date", "Court appearance", "Court appearance date", "Conviction", "Conviction date", ...(canManage ? ["Actions"] : [])].map((head) => <th key={head} className="border-b border-[#d8dee8] px-4 py-3 font-bold">{head}</th>)}</tr></thead>
          <tbody>
            {records.length ? records.map((record, index) => (
              <tr key={record.id || `${record.name}-${index}`} className="hover:bg-[#f8fafc]">
                <td className="border-b border-[#edf0f4] px-4 py-3 font-bold text-[#263747]">{record.name || "-"}</td>
                <td className="border-b border-[#edf0f4] px-4 py-3">{record.relationship_to_child || "-"}</td>
                <td className="border-b border-[#edf0f4] px-4 py-3">{record.sex || "-"}</td>
                <td className="border-b border-[#edf0f4] px-4 py-3">{record.referred_to_police || "-"}</td>
                <td className="border-b border-[#edf0f4] px-4 py-3">{record.police_referral_date || "-"}</td>
                <td className="border-b border-[#edf0f4] px-4 py-3">{record.court_appearance_scheduled || "-"}</td>
                <td className="border-b border-[#edf0f4] px-4 py-3">{record.court_appearance_date || "-"}</td>
                <td className="border-b border-[#edf0f4] px-4 py-3">{record.conviction_determined || "-"}</td>
                <td className="border-b border-[#edf0f4] px-4 py-3">{record.conviction_date || "-"}</td>
                {canManage && <td className="border-b border-[#edf0f4] px-4 py-3"><div className="flex gap-2">{onEdit && <button type="button" title={`Edit ${record.name}`} aria-label={`Edit ${record.name}`} className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] text-[#2e6fa3] hover:border-[#008c7a] hover:text-[#008c7a]" onClick={() => onEdit(index)}><PencilLine className="h-4 w-4" /></button>}{onRemove && <button type="button" title={`Remove ${record.name}`} aria-label={`Remove ${record.name}`} className="grid h-9 w-9 place-items-center rounded-md border border-[#f4b4ac] text-[#b42318] hover:bg-[#fff7f5]" onClick={() => onRemove(index)}><Trash2 className="h-4 w-4" /></button>}</div></td>}
              </tr>
            )) : <tr><td className="px-4 py-10 text-center text-[#64748b]" colSpan={canManage ? 10 : 9}><div className="font-semibold text-[#50617a]">No accused persons captured yet.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SummaryFieldGrid({ items, layout = "grid" }: { items: Array<[string, unknown]>; layout?: "grid" | "stack" }) {
  const capturedItems = items.filter(([, value]) => Array.isArray(value) ? value.some((item) => `${item ?? ""}`.trim()) : `${value ?? ""}`.trim())
  if (!capturedItems.length) return <div className="rounded-md bg-[#f8fafc] px-4 py-5 text-sm text-[#64748b]">No details captured in this section yet.</div>

  return (
    <dl className={layout === "stack" ? "grid gap-y-5" : "grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3"}>
      {capturedItems.map(([label, value]) => {
        const displayValue = Array.isArray(value) ? value.filter((item) => `${item ?? ""}`.trim()).join(", ") : `${value ?? ""}`.trim()
        const isNarrative = displayValue.length > 60 || displayValue.includes("\n")
        return (
          <div key={label} className={`min-w-0 border-b border-[#edf0f4] pb-3 ${layout === "grid" && isNarrative ? "md:col-span-2 xl:col-span-3" : ""}`}>
            <dt className="text-xs font-bold uppercase tracking-wide text-[#64748b]">{label}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-[15px] font-semibold leading-6 text-[#263747]">{displayValue}</dd>
          </div>
        )
      })}
    </dl>
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
  return <Panel title="Requests for More Information" icon={MessageSquareMore}><EmptyState text="No open requests. When an SDO requests more information, the reporter can add it here and the alert returns to Under Review." /></Panel>
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

function notificationToneClasses(priority: WorkflowNotification["priority"]) {
  if (priority === "escalated") return { badge: "bg-[#7f1d1d] text-white", border: "border-[#991b1b]", dot: "bg-[#7f1d1d]" }
  if (priority === "critical") return { badge: "bg-[#fee4e2] text-[#b42318]", border: "border-[#f4b4ac]", dot: "bg-[#ef5350]" }
  if (priority === "warning") return { badge: "bg-[#fff4d6] text-[#a05b16]", border: "border-[#f8c56d]", dot: "bg-[#f59e0b]" }
  return { badge: "bg-[#e7f0fb] text-[#2e6fa3]", border: "border-[#c8d9ee]", dot: "bg-[#2e6fa3]" }
}

function notificationDeadlineLabel(dueAt: string, referenceAt = new Date()) {
  const due = parseWorkflowDate(dueAt)
  if (Number.isNaN(due.getTime())) return "Deadline pending"
  const remainingMs = due.getTime() - referenceAt.getTime()
  const totalMinutes = Math.floor(Math.abs(remainingMs) / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return remainingMs >= 0 ? `${hours}h ${minutes}m left` : `${hours}h ${minutes}m overdue`
}

function NotificationDrawer({
  notifications,
  unreadCount,
  activeCount,
  onClose,
  onViewAll,
  onOpenNotification,
}: {
  notifications: WorkflowNotification[]
  unreadCount: number
  activeCount: number
  onClose: () => void
  onViewAll: () => void
  onOpenNotification: (notification: WorkflowNotification) => void
}) {
  return (
    <div className="fixed inset-0 z-40 bg-[#102033]/35">
      <button className="absolute inset-0 h-full w-full cursor-default" aria-label="Close notifications" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[430px] flex-col bg-white shadow-2xl">
        <div className="border-b border-[#d8dee8] bg-[#f8ffff] p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-[#10233f]">Notifications</h2>
              <p className="mt-2 text-sm leading-6 text-[#5f7191]">Case actions, allocations, approvals and deadline alerts assigned to your role.</p>
            </div>
            <button className="grid h-10 w-10 place-items-center rounded-full bg-[#172033] text-white" title="Close" onClick={onClose}><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full bg-[#0891b2] px-4 py-2 text-xs font-bold uppercase text-white">All {activeCount}</span>
            <span className="rounded-full border border-[#d8dee8] bg-white px-4 py-2 text-xs font-bold uppercase text-[#64748b]">Unread {unreadCount}</span>
            <span className="rounded-full border border-[#d8dee8] bg-white px-4 py-2 text-xs font-bold uppercase text-[#64748b]">Action {notifications.filter((item) => item.priority !== "info").length}</span>
            <button className="rounded-full border border-[#008c7a] bg-white px-4 py-2 text-xs font-bold uppercase text-[#008c7a] hover:bg-[#e7f6f3]" onClick={onViewAll}>View all</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {notifications.length ? (
            <div className="space-y-3">
              {notifications.map((notification) => <WorkflowNotificationCard key={notification.id} notification={notification} compact onOpen={onOpenNotification} />)}
            </div>
          ) : (
            <div className="mt-8 rounded-md border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-8 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-md bg-[#e7f6f3] text-[#008c7a]"><Bell className="h-6 w-6" /></div>
              <h3 className="mt-5 text-base font-bold text-[#172033]">No active notifications right now</h3>
              <p className="mt-2 text-sm leading-6 text-[#64748b]">Workflow actions, approvals and escalation alerts will appear here as soon as they are assigned to you.</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function Notifications({ notifications, onOpenNotification }: { notifications: WorkflowNotification[]; onOpenNotification: (notification: WorkflowNotification) => void }) {
  const [filter, setFilter] = useState<"active" | "unread" | "read" | "resolved">("active")
  const active = notifications.filter((item) => !item.resolvedAt)
  const unread = active.filter((item) => item.unread)
  const read = active.filter((item) => !item.unread)
  const resolved = notifications.filter((item) => item.resolvedAt)
  const visibleNotifications = filter === "resolved" ? resolved : filter === "unread" ? unread : filter === "read" ? read : active
  const grouped = [
    ["Critical", visibleNotifications.filter((item) => item.priority === "escalated" || item.priority === "critical")],
    ["Action Needed", visibleNotifications.filter((item) => item.priority === "warning")],
    ["Information", visibleNotifications.filter((item) => item.priority === "info")],
  ] as const
  const filterOptions: Array<[typeof filter, string, number]> = [
    ["active", "Active", active.length],
    ["unread", "Unread", unread.length],
    ["read", "Read", read.length],
    ["resolved", "Resolved / History", resolved.length],
  ]
  return (
    <Panel title="Notifications" icon={Bell} action={`${active.length} active`}>
      {notifications.length ? (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {filterOptions.map(([key, label, count]) => (
              <button
                key={key}
                className={`rounded-full border px-4 py-2 text-xs font-bold uppercase ${filter === key ? "border-[#008c7a] bg-[#008c7a] text-white" : "border-[#d8dee8] bg-white text-[#64748b] hover:border-[#008c7a] hover:text-[#008c7a]"}`}
                onClick={() => setFilter(key)}
              >
                {label} {count}
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <MiniCard title="Critical" value={String(visibleNotifications.filter((item) => item.priority === "critical" || item.priority === "escalated").length)} icon={ShieldAlert} />
            <MiniCard title="Warnings" value={String(visibleNotifications.filter((item) => item.priority === "warning").length)} icon={Clock3} />
            <MiniCard title="Allocations" value={String(visibleNotifications.filter((item) => item.category === "Allocation").length)} icon={Users} />
            <MiniCard title="Approvals" value={String(visibleNotifications.filter((item) => ["Intake", "Care Plan"].includes(item.category)).length)} icon={ClipboardCheck} />
          </div>
          {visibleNotifications.length ? grouped.map(([label, items]) => items.length ? (
            <section key={label}>
              <h3 className="mb-3 text-sm font-bold uppercase text-[#64748b]">{label}</h3>
              <div className="space-y-3">
                {items.map((notification) => <WorkflowNotificationCard key={notification.id} notification={notification} onOpen={onOpenNotification} />)}
              </div>
            </section>
          ) : null) : <EmptyState text={`No ${filter === "resolved" ? "resolved history" : filter} notifications found.`} />}
        </div>
      ) : <EmptyState text="No notifications are available yet. Case actions, approvals and escalation alerts will appear here as soon as they are assigned to you." />}
    </Panel>
  )
}

function WorkflowNotificationCard({ notification, compact = false, onOpen }: { notification: WorkflowNotification; compact?: boolean; onOpen: (notification: WorkflowNotification) => void }) {
  const tone = notificationToneClasses(notification.priority)
  const sentDeadlineStatus = notification.dueAt
    ? notificationDeadlineLabel(notification.dueAt)
    : ""
  return (
    <button type="button" className={`block w-full cursor-pointer rounded-md border bg-white text-left transition hover:bg-[#f8fafc] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#008c7a]/40 ${tone.border} ${compact ? "p-3" : "p-4"} shadow-sm`} title={notification.actionLabel || "Open case"} onClick={() => onOpen(notification)}>
      <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${tone.badge}`}>{notification.priority}</span>
            <span className="text-xs font-bold uppercase text-[#64748b]">{notification.category}</span>
          </div>
          <h3 className={`${compact ? "mt-2 text-sm" : "mt-3 text-base"} font-bold text-[#172033]`}>{notification.title}</h3>
          <p className={`${compact ? "mt-1 text-xs" : "mt-2 text-sm"} leading-6 text-[#5f7191]`}>{notification.message}</p>
          <div className={`${compact ? "mt-2" : "mt-3"} flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-[#64748b]`}>
            <span>{notification.updatedAt && notification.updatedAt !== notification.createdAt ? "Updated" : "Sent"} {formatWorkflowDateTime(notification.updatedAt || notification.createdAt)}{sentDeadlineStatus ? ` · ${sentDeadlineStatus}` : ""}</span>
          </div>
          {!compact && (
            <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-[#64748b]">
              <span>Target: {notification.targetId}</span>
              {notification.dueAt && <span>Due: {formatWorkflowDateTime(notification.dueAt)}</span>}
              {notification.resolvedAt && <span>Resolved: {formatWorkflowDateTime(notification.resolvedAt)}</span>}
              {!notification.resolvedAt && <span>{notification.unread ? "Unread" : "Read"}</span>}
            </div>
          )}
      </div>
    </button>
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
        <ReadonlyField label="Organization" value={user.profile.organizationName || "NCPMIS"} />
      </FormGrid>
    </Panel>
  )
}

const partnerTypeOptions = ["NGO", "Government Department", "Hospital/Clinic", "Police/VFU", "School", "Faith Based Organisation", "Community Based Organisation", "Place of Safety", "Legal Aid", "Other"]
const serviceOptions = ["Child Protection", "Counselling", "Psychosocial Support", "Medical Examination", "GBV Support", "Legal Aid", "Court Support", "Education Support", "Food Assistance", "Shelter / Place of Safety", "Family Reunification", "Livelihood Support", "Birth Registration", "Disability Support", "Substance Abuse Support", "HIV Sensitive Case Management", "Other"]
const courtTypeOptions = ["Magistrates Court", "Children's Court", "High Court", "Community Court", "Other"]
const fallbackRelationshipOptions = ["Mother", "Father", "Stepmother", "Stepfather", "Brother", "Sister", "Stepbrother", "Stepsister", "Grandmother", "Grandfather", "Aunt", "Uncle", "Niece", "Guardian", "Caregiver", "Teacher", "Health worker", "Police officer", "Social worker", "Neighbour", "Community worker", "Child self-report", "Other", "Unknown"]

function relationshipOptions(relationshipTypes: RelationshipTypeOption[]) {
  const active = relationshipTypes.filter((item) => item.status !== "Inactive").map((item) => item.name).filter(Boolean)
  return active.length ? active : fallbackRelationshipOptions
}

function RelationshipSelect({ value, onChange, relationshipTypes, disabled }: { value: string; onChange: (value: string) => void; relationshipTypes: RelationshipTypeOption[]; disabled?: boolean }) {
  const options = relationshipOptions(relationshipTypes)
  const visibleOptions = value && !options.includes(value) ? [value, ...options] : options
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", close)
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("mousedown", close)
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [open])
  return (
    <div ref={containerRef} className="relative">
      <button type="button" className={`${inputClass} flex items-center justify-between text-left disabled:cursor-not-allowed disabled:bg-[#f8fafc]`} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span className={value ? "text-[#263747]" : "text-[#64748b]"}>{value || "Select relationship"}</span><ChevronDown className={`h-4 w-4 shrink-0 transition ${open ? "rotate-180" : ""}`} /></button>
      {open && <div role="listbox" className="absolute z-[70] mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-[#cbd5e1] bg-white py-1 shadow-xl">
        <button type="button" role="option" aria-selected={!value} className="block w-full px-4 py-2 text-left text-sm font-semibold text-[#64748b] hover:bg-[#eef9f6]" onClick={() => { onChange(""); setOpen(false) }}>Select relationship</button>
        {visibleOptions.map((item) => <button type="button" role="option" aria-selected={value === item} key={item} className={`block w-full px-4 py-2 text-left text-sm font-semibold hover:bg-[#eef9f6] ${value === item ? "bg-[#e7f6f3] text-[#0f766e]" : "text-[#263747]"}`} onClick={() => { onChange(item); setOpen(false) }}>{item}</button>)}
      </div>}
    </div>
  )
}

function PartnerManagementSetup({
  view,
  user,
  provinces,
  districts,
  wards,
  refreshReferenceData,
}: {
  view: string
  user: ApiUser
  provinces: ProvinceOption[]
  districts: DistrictOption[]
  wards: WardOption[]
  refreshReferenceData: (preserve?: ReferenceDataPreserve) => Promise<{ provinceData: ProvinceOption[]; districtData: DistrictOption[]; wardData: WardOption[]; organizationData: OrganizationOption[]; relationshipTypeData: RelationshipTypeOption[] }>
}) {
  const configs: Record<string, { title: string; endpoint: string; nameKey: keyof SetupRecord; typeKey?: keyof SetupRecord; typeLabel?: string; createLabel: string; tableMinWidth: string }> = {
    provinces: { title: "Provinces", endpoint: "/provinces/", nameKey: "name", createLabel: "Add Prov", tableMinWidth: "900px" },
    districts: { title: "Districts", endpoint: "/districts/", nameKey: "name", createLabel: "Add District", tableMinWidth: "980px" },
    "district-wards": { title: "District Wards", endpoint: "/wards/", nameKey: "name", createLabel: "Add Ward", tableMinWidth: "1040px" },
    ccws: { title: "CCWs", endpoint: "/ccws/", nameKey: "full_name", typeKey: "gender", typeLabel: "Gender", createLabel: "Add CCW", tableMinWidth: "1280px" },
    "partners-in-district": { title: "Partners in District", endpoint: "/partners-in-district/", nameKey: "partner_name", typeKey: "partner_type", typeLabel: "Partner type", createLabel: "Add Partner", tableMinWidth: "1320px" },
    places: { title: "Places of Safety", endpoint: "/partners-in-district/", nameKey: "partner_name", createLabel: "Add Place", tableMinWidth: "1180px" },
    "register-courts": { title: "Register Courts", endpoint: "/courts/", nameKey: "court_name", typeKey: "court_type", typeLabel: "Court type", createLabel: "Add Court", tableMinWidth: "1180px" },
    "relationship-types": { title: "Relationship Types", endpoint: "/relationship-types/", nameKey: "name", createLabel: "Add Relationship", tableMinWidth: "940px" },
  }
  const config = configs[view]
  const [records, setRecords] = useState<SetupRecord[]>([])
  const [search, setSearch] = useState("")
  const [provinceFilter, setProvinceFilter] = useState(user.profile.province ? String(user.profile.province) : "")
  const [districtFilter, setDistrictFilter] = useState(user.profile.district ? String(user.profile.district) : "")
  const [wardFilter, setWardFilter] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalRecord, setModalRecord] = useState<SetupRecord | null>(null)
  const [modalMode, setModalMode] = useState<"view" | "edit">("edit")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [openActionId, setOpenActionId] = useState<number | null>(null)
  const [form, setForm] = useState<SetupRecord>({ id: 0, status: "Active", services_offered: [] })
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [saving, setSaving] = useState(false)
  const preservedRecordsRef = useRef<Record<string, SetupRecord[]>>({})
  const loadRequestRef = useRef(0)
  const isNational = ["SYS_ADMIN", "DEPUTY_DIRECTOR", "DIRECTOR", "PROGRAMME_OFFICER"].includes(user.profile.role)
  const isProvinceUser = user.profile.role === "PROVINCIAL_HEAD"
  const isDistrictScopedManager = ["DISTRICT_HEAD", "DSDO"].includes(user.profile.role)
  const scopedDistrict = isDistrictScopedManager ? districts.find((item) => item.id === user.profile.district) || (districts.length === 1 ? districts[0] : null) : null
  const scopedProvinceId = user.profile.province || scopedDistrict?.province || null
  const canManage = view === "relationship-types" ? user.profile.role === "SYS_ADMIN" : view === "provinces" || view === "districts" ? isNational : isNational || isDistrictScopedManager
  const visibleDistricts = provinceFilter ? districts.filter((item) => item.province === Number(provinceFilter)) : districts
  const formDistricts = isDistrictScopedManager ? (scopedDistrict ? [scopedDistrict] : []) : form.province ? districts.filter((item) => item.province === Number(form.province)) : districts
  const formWards = form.district ? wards.filter((item) => item.district === Number(form.district)) : []
  const filteredWards = districtFilter ? wards.filter((item) => item.district === Number(districtFilter)) : []
  const showProvinceFilter = isNational && !["provinces", "relationship-types"].includes(view)
  const showDistrictFilter = !["provinces", "districts", "relationship-types"].includes(view) && !isDistrictScopedManager
  const showTypeFilter = Boolean(config.typeKey)
  const showWardFilter = view === "ccws"
  const hasAdvancedFilters = showProvinceFilter || showDistrictFilter || showWardFilter || showTypeFilter || true

  function defaultProvinceFilter() {
    return scopedProvinceId ? String(scopedProvinceId) : ""
  }

  function defaultDistrictFilter() {
    return scopedDistrict ? String(scopedDistrict.id) : user.profile.district ? String(user.profile.district) : ""
  }

  type SetupFilterOverrides = Partial<{
    search: string
    provinceFilter: string
    districtFilter: string
    wardFilter: string
    typeFilter: string
    statusFilter: string
  }>

  function preservedRecords() {
    return preservedRecordsRef.current[view] || []
  }

  function preserveRecord(record: SetupRecord) {
    preservedRecordsRef.current = {
      ...preservedRecordsRef.current,
      [view]: upsertById(preservedRecords(), record, true),
    }
  }

  function forgetPreservedRecord(recordId: number) {
    preservedRecordsRef.current = {
      ...preservedRecordsRef.current,
      [view]: preservedRecords().filter((item) => item.id !== recordId),
    }
  }

  async function loadRecords(overrides: SetupFilterOverrides = {}) {
    const requestId = ++loadRequestRef.current
    const nextSearch = overrides.search ?? search
    const nextProvinceFilter = overrides.provinceFilter ?? provinceFilter
    const nextDistrictFilter = overrides.districtFilter ?? districtFilter
    const nextWardFilter = overrides.wardFilter ?? wardFilter
    const nextTypeFilter = overrides.typeFilter ?? typeFilter
    const nextStatusFilter = overrides.statusFilter ?? statusFilter
    const params = new URLSearchParams()
    if (nextSearch.trim()) params.set("search", nextSearch.trim())
    if (nextProvinceFilter && !["provinces", "relationship-types"].includes(view)) params.set("province", nextProvinceFilter)
    if (nextDistrictFilter && !["provinces", "districts", "relationship-types"].includes(view)) params.set("district", nextDistrictFilter)
    if (nextWardFilter && view === "ccws") params.set("ward", nextWardFilter)
    if (view === "places") params.set("type", "Place of Safety")
    else if (nextTypeFilter) params.set("type", nextTypeFilter)
    if (nextStatusFilter) params.set("status", nextStatusFilter)
    // Province/District dropdowns already use the authoritative location
    // snapshot.  Use that exact source for these two grids too: the separate
    // list routes can otherwise return a stale empty result while the dropdown
    // correctly shows the records that exist in the database.
    let data: SetupRecord[]
    if (view === "provinces" || view === "districts") {
      const masterRecords = (view === "provinces" ? provinces : districts) as SetupRecord[]
      const searchTerm = nextSearch.trim().toLowerCase()
      data = masterRecords.filter((record) => {
        const matchesSearch = !searchTerm || [record.name, record.code, record.provinceName]
          .some((value) => String(value || "").toLowerCase().includes(searchTerm))
        return matchesSearch && (!nextStatusFilter || record.status === nextStatusFilter)
      })
    } else {
      data = await apiGet<SetupRecord[]>(`${config.endpoint}${params.toString() ? `?${params}` : ""}`)
    }
    const merged = mergeById(data, preservedRecords(), true)
    // Navigation and filters can issue overlapping requests.  Only the newest
    // response is allowed to update the grid, so an older empty response cannot
    // overwrite a successful master-data response.
    if (requestId === loadRequestRef.current) setRecords(merged)
    return merged
  }

  useEffect(() => { void loadRecords().catch((err) => setError(err instanceof Error ? err.message : "Could not load records.")) }, [view, search, provinceFilter, districtFilter, wardFilter, typeFilter, statusFilter])
  useEffect(() => setPage(1), [search, provinceFilter, districtFilter, wardFilter, typeFilter, statusFilter, rowsPerPage])

  const pageCount = Math.max(1, Math.ceil(records.length / rowsPerPage))
  const safePage = Math.min(page, pageCount)
  const pageRows = records.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage)
  const pageStart = records.length ? (safePage - 1) * rowsPerPage + 1 : 0
  const pageEnd = Math.min(records.length, safePage * rowsPerPage)

  function openModal(record?: SetupRecord, mode: "view" | "edit" = "edit") {
    const userDistrict = user.profile.district ? districts.find((item) => item.id === user.profile.district) : null
    const lockedDistrict = scopedDistrict || userDistrict
    const base: SetupRecord = {
      id: 0,
      status: "Active",
      services_offered: [],
      province: scopedProvinceId || userDistrict?.province || null,
      district: lockedDistrict?.id || user.profile.district || null,
      ward: user.profile.ward || null,
    }
    setModalRecord(record || null)
    setModalMode(mode)
    setForm(record ? { ...base, ...record, services_offered: record.services_offered || [] } : base)
    setModalOpen(true)
    setOpenActionId(null)
    setError("")
    setNotice("")
  }

  function closeModal() {
    setModalOpen(false)
    setModalRecord(null)
    setModalMode("edit")
    setForm({ id: 0, status: "Active", services_offered: [] })
    setError("")
  }

  function setFormValue(key: keyof SetupRecord, value: string | number | null | string[]) {
    setForm((current) => {
      const next = { ...current, [key]: value }
      if (key === "province") {
        next.district = null
        next.ward = null
      }
      if (key === "district") {
        const district = districts.find((item) => item.id === Number(value))
        next.province = district?.province || next.province || null
        next.ward = null
      }
      return next
    })
  }

  async function saveRecord() {
    if (saving) return
    setSaving(true)
    setError("")
    setNotice("")
    try {
      if (isDistrictScopedManager && !scopedDistrict) {
        throw new Error("Your account needs an assigned district before you can create or edit partner management records.")
      }
      const payload = buildSetupPayload(view, isDistrictScopedManager && scopedDistrict ? { ...form, province: scopedDistrict.province, district: scopedDistrict.id } : form)
      const creating = !modalRecord?.id
      const savedRecord = modalRecord?.id
        ? await apiPatch<SetupRecord>(`${config.endpoint}${modalRecord.id}/`, payload)
        : await apiPost<SetupRecord>(config.endpoint, payload)
      preserveRecord(savedRecord)
      setRecords((current) => upsertById(current, savedRecord, creating))
      closeModal()
      let refreshedRecords: SetupRecord[]
      if (creating) {
        const nextProvinceFilter = defaultProvinceFilter()
        const nextDistrictFilter = defaultDistrictFilter()
        setSearch("")
        setProvinceFilter(nextProvinceFilter)
        setDistrictFilter(nextDistrictFilter)
        setWardFilter("")
        setTypeFilter("")
        setStatusFilter("")
        setPage(1)
        refreshedRecords = await loadRecords({ search: "", provinceFilter: nextProvinceFilter, districtFilter: nextDistrictFilter, wardFilter: "", typeFilter: "", statusFilter: "" })
      } else {
        refreshedRecords = await loadRecords()
      }
      setRecords(mergeById(refreshedRecords, [savedRecord], creating))
      if (["provinces", "districts", "district-wards", "relationship-types"].includes(view)) await refreshReferenceData(referencePreserveForSetup(view, savedRecord))
      setNotice(`${config.title.slice(0, -1) || "Record"} has been ${creating ? "saved" : "updated"} successfully.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save record.")
    } finally {
      setSaving(false)
    }
  }

  async function deleteRecord(record: SetupRecord) {
    const label = String(record[config.nameKey] || "this record")
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return
    try {
      await apiDelete(`${config.endpoint}${record.id}/`)
      forgetPreservedRecord(record.id)
      await loadRecords()
      if (["provinces", "districts", "district-wards", "relationship-types"].includes(view)) await refreshReferenceData()
      setNotice(`${label} has been deleted successfully.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete record.")
    }
  }

  async function toggleRecordStatus(record: SetupRecord) {
    try {
      const savedRecord = await apiPatch<SetupRecord>(`${config.endpoint}${record.id}/`, { status: record.status === "Inactive" ? "Active" : "Inactive" })
      preserveRecord(savedRecord)
      setRecords((current) => upsertById(current, savedRecord))
      setOpenActionId(null)
      const refreshedRecords = await loadRecords()
      setRecords(mergeById(refreshedRecords, [savedRecord]))
      setNotice(`${String(record[config.nameKey] || "Record")} has been ${record.status === "Inactive" ? "activated" : "deactivated"} successfully.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update status.")
    }
  }

  function clearFilters() {
    setProvinceFilter(defaultProvinceFilter())
    setDistrictFilter(defaultDistrictFilter())
    setWardFilter("")
    setTypeFilter("")
    setStatusFilter("")
  }

  const typeOptions = view === "partners-in-district" ? partnerTypeOptions : view === "register-courts" ? courtTypeOptions : view === "ccws" ? ["Female", "Male", "Other"] : []
  const filtersDisabledForProvince = isProvinceUser || isDistrictScopedManager
  const districtDisabled = isDistrictScopedManager
  const tableHeaders = getSetupTableHeaders(view)
  const createButton = canManage ? (
    <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#008c7a] px-4 text-sm font-semibold text-white hover:bg-[#007767]" onClick={() => openModal()}>
      <Plus className="h-4 w-4" /> {config.createLabel}
    </button>
  ) : `${records.length} records`

  return (
    <Panel title={config.title} icon={BriefcaseBusiness} action={`${records.length} records`}>
      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}
      <div className="mb-4 rounded-md border border-[#d8dee8] bg-[#fbfdff] p-3">
        <div className="grid items-center gap-3 md:grid-cols-[1fr_minmax(280px,420px)_auto_auto]">
          <span className="flex justify-start">{canManage && createButton}</span>
          <span className="relative block w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
            <input className={`${inputClass} h-10 pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${config.title.toLowerCase()}...`} />
          </span>
          {hasAdvancedFilters && <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#d8dee8] bg-white px-3 text-sm font-semibold text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]" onClick={() => setFiltersOpen((open) => !open)}>
            <Settings className="h-4 w-4" /> Filters
            <ChevronDown className={`h-4 w-4 transition ${filtersOpen ? "rotate-180" : ""}`} />
          </button>}
          <span className="justify-self-start rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-bold text-[#263747] md:justify-self-end">{records.length} records</span>
        </div>
        {filtersOpen && <div className="mt-3 grid gap-3 border-t border-[#d8dee8] pt-3 sm:grid-cols-2 lg:grid-cols-5">
          {showProvinceFilter && <FilterSelect label="Province" value={provinceFilter} disabled={filtersDisabledForProvince} onChange={(value) => { setProvinceFilter(value); setDistrictFilter(""); setWardFilter("") }} options={provinces.map((item) => [String(item.id), item.name])} empty="All provinces" />}
          {showDistrictFilter && <FilterSelect label="District" value={districtFilter} disabled={districtDisabled} onChange={(value) => { setDistrictFilter(value); setWardFilter("") }} options={visibleDistricts.map((item) => [String(item.id), item.name])} empty="All districts" />}
          {showWardFilter && <FilterSelect label="Base ward" value={wardFilter} onChange={setWardFilter} options={filteredWards.map((item) => [String(item.id), item.name])} empty="All base wards" />}
          {showTypeFilter && <FilterSelect label={config.typeLabel || "Type"} value={typeFilter} onChange={setTypeFilter} options={typeOptions.map((item) => [item, item])} empty="All types" />}
          <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={[["Active", "Active"], ["Inactive", "Inactive"]]} empty="All statuses" />
          <div className="flex items-end"><button className="h-10 rounded-md border border-[#d8dee8] bg-white px-3 text-sm font-semibold text-[#263747] hover:border-[#008c7a]" onClick={clearFilters}>Clear filters</button></div>
        </div>}
      </div>
      <div className="overflow-hidden rounded-md border border-[#d8dee8] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm" style={{ minWidth: config.tableMinWidth }}>
            <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{tableHeaders.map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-2">{head}</th>)}</tr></thead>
            <tbody>
              {pageRows.length ? pageRows.map((record) => (
                <tr key={record.id} className="border-b border-[#edf0f4] align-middle hover:bg-[#fbfdff]">
                  {renderSetupCells(view, record, () => openModal(record, "view"))}
                  <SetupActions record={record} canManage={canManage} isOpen={openActionId === record.id} setOpen={setOpenActionId} onView={() => openModal(record, "view")} onEdit={() => openModal(record, "edit")} onToggleStatus={() => toggleRecordStatus(record)} onDelete={() => deleteRecord(record)} />
                </tr>
              )) : <tr><td className="px-3 py-8 text-center text-[#64748b]" colSpan={tableHeaders.length}>{records.length ? "No records match the selected filters." : `No ${config.title.toLowerCase()} configured yet.`}</td></tr>}
            </tbody>
          </table>
        </div>
        <TablePagination totalRows={records.length} pageStart={pageStart} pageEnd={pageEnd} rowsPerPage={rowsPerPage} setRowsPerPage={setRowsPerPage} page={safePage} pageCount={pageCount} setPage={setPage} />
      </div>
      {notice && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-[#102033]/55 p-4">
          <div className="w-full max-w-md rounded-md border border-[#cfe4df] bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#e7f6f3] text-[#008c7a]">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-xl font-bold text-[#263747]">Record saved</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7191]">{notice}</p>
            <button className="mt-6 h-11 rounded-md bg-[#008c7a] px-8 font-semibold text-white hover:bg-[#007767]" onClick={() => setNotice("")}>OK</button>
          </div>
        </div>
      )}
      {modalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102033]/55 p-4">
          <form className="max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-md border border-[#cfd8e6] bg-white shadow-2xl" autoComplete="off" onSubmit={(event) => { event.preventDefault(); if (canManage && modalMode === "edit") void saveRecord() }}>
            <div className="flex items-center justify-between gap-3 border-b border-[#d8dee8] bg-[#f8fafc] px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-[#263747]">{modalRecord ? formatSetupText(form[config.nameKey]) : config.createLabel}</h3>
                <p className="mt-1 text-xs font-semibold uppercase text-[#64748b]">{config.title}</p>
              </div>
              <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-lg font-bold text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]" onClick={closeModal} aria-label="Close modal">x</button>
            </div>
            <div className="max-h-[calc(88vh-136px)] overflow-y-auto p-5">
              {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
              <SetupForm view={view} form={form} setFormValue={setFormValue} provinces={provinces} districts={formDistricts} wards={formWards} lockedProvince={isProvinceUser || isDistrictScopedManager} lockedDistrict={isDistrictScopedManager} readOnly={modalMode === "view" || (!canManage && Boolean(modalRecord))} />
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-[#d8dee8] bg-[#f8fafc] px-5 py-4">
              <button type="button" className="h-10 rounded-md border border-[#d8dee8] bg-white px-4 text-sm font-semibold text-[#263747] hover:border-[#008c7a]" onClick={closeModal}>Cancel</button>
              {canManage && modalMode === "edit" && <button type="submit" disabled={saving} className="h-10 rounded-md bg-[#008c7a] px-5 text-sm font-semibold text-white hover:bg-[#007767] disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Saving..." : "Save record"}</button>}
            </div>
          </form>
        </div>
      )}
    </Panel>
  )
}

function getSetupTableHeaders(view: string) {
  if (view === "provinces") return ["Province", "Code", "Updated", "Updated By", "Status", "Actions"]
  if (view === "relationship-types") return ["Relationship", "Description", "Updated", "Updated By", "Status", "Actions"]
  if (view === "districts") return ["District", "Code", "Province", "Updated", "Updated By", "Status", "Actions"]
  if (view === "district-wards") return ["Ward", "District", "Province", "Description", "Status", "Actions"]
  if (view === "ccws") return ["CCW", "Username", "District", "Province", "Ward", "Phone", "Email", "Gender", "Status", "Actions"]
  if (view === "places") return ["Place of Safety", "District", "Province", "Contact Person", "Phone", "Email", "Address", "Operating Area", "Status", "Actions"]
  if (view === "partners-in-district") return ["Partner", "Type", "District", "Province", "Operating Area", "Contact Person", "Phone", "Email", "Services", "Status", "Actions"]
  return ["Court", "Type", "District", "Province", "Contact Person", "Phone", "Email", "Status", "Actions"]
}

function SetupPrimary({ title, onClick }: { title: ReactNode; onClick?: () => void }) {
  return (
    <button className="max-w-[240px] truncate text-left font-bold text-[#263747] underline-offset-2 hover:text-[#008c7a] hover:underline" onClick={onClick}>{title}</button>
  )
}

function SetupCellText({ value, strong = false, muted = false, max = "max-w-[220px]" }: { value?: ReactNode; strong?: boolean; muted?: boolean; max?: string }) {
  const empty = value === null || value === undefined || value === ""
  return <span className={`${max} block truncate ${strong ? "font-bold text-[#263747]" : muted || empty ? "text-[#64748b]" : "font-semibold text-[#263747]"}`}>{empty ? "Not captured" : value}</span>
}

function renderSetupCells(view: string, record: SetupRecord, openView: () => void) {
  const cellClass = "px-3 py-2"
  const updatedDate = record.updated_at ? new Date(record.updated_at).toLocaleDateString() : "Not updated"
  const updatedBy = record.updatedByName || record.createdByName || "User not captured"
  const districtName = record.districtName || "District not captured"
  const provinceName = record.provinceName || "Province not captured"
  const statusCell = <td className={cellClass}><StatusBadge status={record.status || "Active"} /></td>
  if (view === "relationship-types") {
    return <>
      <td className={cellClass}><SetupPrimary title={formatSetupText(record.name)} onClick={openView} /></td>
      <td className={cellClass}><SetupCellText value={formatSetupValue(record.description)} muted max="max-w-[320px]" /></td>
      <td className={cellClass}><SetupCellText value={updatedDate} /></td>
      <td className={cellClass}><SetupCellText value={updatedBy} muted /></td>
      {statusCell}
    </>
  }
  if (view === "provinces") {
    return <>
      <td className={cellClass}><SetupPrimary title={formatSetupText(record.name)} onClick={openView} /></td>
      <td className={cellClass}><SetupCellText value={formatSetupValue(record.code)} muted /></td>
      <td className={cellClass}><SetupCellText value={updatedDate} /></td>
      <td className={cellClass}><SetupCellText value={updatedBy} muted /></td>
      {statusCell}
    </>
  }
  if (view === "districts") {
    return <>
      <td className={cellClass}><SetupPrimary title={formatSetupText(record.name)} onClick={openView} /></td>
      <td className={cellClass}><SetupCellText value={record.code || "No district code"} muted /></td>
      <td className={cellClass}><SetupCellText value={provinceName} /></td>
      <td className={cellClass}><SetupCellText value={updatedDate} /></td>
      <td className={cellClass}><SetupCellText value={updatedBy} muted /></td>
      {statusCell}
    </>
  }
  if (view === "district-wards") {
    return <>
      <td className={cellClass}><SetupPrimary title={formatSetupText(record.name)} onClick={openView} /></td>
      <td className={cellClass}><SetupCellText value={districtName} /></td>
      <td className={cellClass}><SetupCellText value={provinceName} /></td>
      <td className={cellClass}><SetupCellText value={formatSetupValue(record.description)} muted max="max-w-[280px]" /></td>
      {statusCell}
    </>
  }
  if (view === "ccws") {
    return <>
      <td className={cellClass}><SetupPrimary title={formatSetupText(record.full_name)} onClick={openView} /></td>
      <td className={cellClass}><SetupCellText value={record.username || "No portal username"} muted /></td>
      <td className={cellClass}><SetupCellText value={districtName} /></td>
      <td className={cellClass}><SetupCellText value={provinceName} /></td>
      <td className={cellClass}><SetupCellText value={record.wardName || "All district wards"} muted /></td>
      <td className={cellClass}><SetupCellText value={record.phone || "No phone"} /></td>
      <td className={cellClass}><SetupCellText value={record.email || "No email"} muted /></td>
      <td className={cellClass}><SetupCellText value={record.gender || "Not captured"} muted /></td>
      {statusCell}
    </>
  }
  if (view === "places") {
    return <>
      <td className={cellClass}><SetupPrimary title={formatSetupText(record.partner_name)} onClick={openView} /></td>
      <td className={cellClass}><SetupCellText value={districtName} /></td>
      <td className={cellClass}><SetupCellText value={provinceName} /></td>
      <td className={cellClass}><SetupCellText value={record.contact_person || "No contact person"} /></td>
      <td className={cellClass}><SetupCellText value={record.phone || "No phone"} /></td>
      <td className={cellClass}><SetupCellText value={record.email || "No email"} muted /></td>
      <td className={cellClass}><SetupCellText value={record.address || "No address"} muted /></td>
      <td className={cellClass}><SetupCellText value={record.operating_area || "Not captured"} muted /></td>
      {statusCell}
    </>
  }
  if (view === "partners-in-district") {
    return <>
      <td className={cellClass}><SetupPrimary title={formatSetupText(record.partner_name)} onClick={openView} /></td>
      <td className={cellClass}><SetupCellText value={formatOtherLabel(record.partner_type, record.partner_type_other)} muted /></td>
      <td className={cellClass}><SetupCellText value={districtName} /></td>
      <td className={cellClass}><SetupCellText value={provinceName} /></td>
      <td className={cellClass}><SetupCellText value={record.operating_area || "Not captured"} muted /></td>
      <td className={cellClass}><SetupCellText value={record.contact_person || "No contact person"} /></td>
      <td className={cellClass}><SetupCellText value={record.phone || "No phone"} /></td>
      <td className={cellClass}><SetupCellText value={record.email || "No email"} muted /></td>
      <td className={cellClass}><ServiceChips services={record.services_offered || []} otherService={record.services_offered_other} /></td>
      {statusCell}
    </>
  }
  return <>
    <td className={cellClass}><SetupPrimary title={formatSetupText(record.court_name)} onClick={openView} /></td>
    <td className={cellClass}><SetupCellText value={formatOtherLabel(record.court_type, record.court_type_other)} muted /></td>
    <td className={cellClass}><SetupCellText value={districtName} /></td>
    <td className={cellClass}><SetupCellText value={provinceName} /></td>
    <td className={cellClass}><SetupCellText value={record.contact_person || "No contact person"} /></td>
    <td className={cellClass}><SetupCellText value={record.phone || "No phone"} /></td>
    <td className={cellClass}><SetupCellText value={record.email || "No email"} muted /></td>
    {statusCell}
  </>
}

function SetupActions({ record, canManage, isOpen, setOpen, onView, onEdit, onToggleStatus, onDelete }: { record: SetupRecord; canManage: boolean; isOpen: boolean; setOpen: (id: number | null) => void; onView: () => void; onEdit: () => void; onToggleStatus: () => void; onDelete: () => void }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })

  useEffect(() => {
    if (!isOpen) return

    const positionMenu = () => {
      const button = buttonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      const menuWidth = 160
      const menuHeight = canManage ? 164 : 44
      const gap = 8
      const viewportPadding = 12
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      const opensBelow = spaceBelow >= menuHeight + gap || spaceBelow >= spaceAbove
      const left = Math.min(Math.max(viewportPadding, rect.right - menuWidth), window.innerWidth - menuWidth - viewportPadding)
      const top = opensBelow ? rect.bottom + gap : Math.max(viewportPadding, rect.top - menuHeight - gap)
      setMenuPosition({ left, top })
    }

    positionMenu()
    window.addEventListener("resize", positionMenu)
    window.addEventListener("scroll", positionMenu, true)
    return () => {
      window.removeEventListener("resize", positionMenu)
      window.removeEventListener("scroll", positionMenu, true)
    }
  }, [canManage, isOpen])

  const menu = isOpen ? (
    <div className="fixed z-[100] w-40 overflow-hidden rounded-md border border-[#d8dee8] bg-white py-1 text-left shadow-xl" style={{ left: menuPosition.left, top: menuPosition.top }}>
      <button className="block w-full px-3 py-2 text-sm font-semibold text-[#263747] hover:bg-[#f8fafc]" onClick={onView}>View</button>
      {canManage && <button className="block w-full px-3 py-2 text-sm font-semibold text-[#263747] hover:bg-[#f8fafc]" onClick={onEdit}>Edit</button>}
      {canManage && <button className="block w-full px-3 py-2 text-sm font-semibold text-[#263747] hover:bg-[#f8fafc]" onClick={onToggleStatus}>{record.status === "Inactive" ? "Activate" : "Deactivate"}</button>}
      {canManage && <button className="block w-full px-3 py-2 text-sm font-semibold text-[#b42318] hover:bg-[#fef3f2]" onClick={onDelete}>Delete</button>}
    </div>
  ) : null

  return (
    <td className="px-3 py-2 text-right">
      <button ref={buttonRef} className="grid h-8 w-8 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]" title="Actions" onClick={() => setOpen(isOpen ? null : record.id)}>
        <MoreVertical className="h-4 w-4" />
      </button>
      {menu && createPortal(menu, document.body)}
    </td>
  )
}

function FilterSelect({ label, value, options, empty, disabled, onChange }: { label: string; value: string; options: string[][]; empty: string; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <label className="grid min-w-[180px] gap-1 text-sm font-semibold text-[#263747]">
      <span>{label}</span>
      <select className={`${inputClass} h-10 disabled:bg-[#eef2f5] disabled:text-[#8aa0bf]`} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">{empty}</option>
        {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select>
    </label>
  )
}

function ServiceChips({ services, otherService }: { services: string[]; otherService?: string }) {
  if (!services.length) return <span className="text-[#94a3b8]">Not captured</span>
  const labels = services.map((item) => item === "Other" && otherService ? `Other: ${otherService}` : item)
  return <div className="flex max-w-[340px] flex-wrap gap-1.5">{labels.slice(0, 3).map((item) => <span key={item} className="rounded-full bg-[#e7f0fb] px-2 py-1 text-[11px] font-bold text-[#2e6fa3]">{item}</span>)}{labels.length > 3 && <span className="rounded-full bg-[#fff4d6] px-2 py-1 text-[11px] font-bold text-[#a05b16]">+{labels.length - 3} more</span>}</div>
}

function formatOtherLabel(value: unknown, otherValue: unknown) {
  if (value === "Other" && otherValue) return `Other: ${otherValue}`
  return formatSetupValue(value)
}

function formatSetupValue(value: unknown) {
  if (!value) return <span className="text-[#94a3b8]">Not captured</span>
  if (typeof value === "string" && value.includes("T")) return new Date(value).toLocaleDateString()
  return String(value)
}

function formatSetupText(value: unknown) {
  if (!value) return "Not captured"
  if (typeof value === "string" && value.includes("T")) return new Date(value).toLocaleDateString()
  return String(value)
}

function buildSetupPayload(view: string, form: SetupRecord) {
  if (view === "provinces") return { name: form.name || "", code: form.code || "", status: form.status || "Active" }
  if (view === "relationship-types") return { name: form.name || "", description: form.description || "", status: form.status || "Active" }
  if (view === "districts") return { province: form.province, name: form.name || "", code: (form.code || "").toUpperCase(), status: form.status || "Active" }
  if (view === "district-wards") return { district: form.district, name: form.name || "", description: form.description || "", status: form.status || "Active" }
  if (view === "ccws") return { district: form.district, ward: form.ward || null, username: form.username || "", password: form.password || "", full_name: form.full_name || "", national_id: form.national_id || "", gender: form.gender || "", phone: form.phone || "", email: form.email || "", physical_address: form.physical_address || "", status: form.status || "Active", date_registered: form.date_registered || null }
  if (view === "places") return { district: form.district, partner_name: form.partner_name || "", partner_type: "Place of Safety", partner_type_other: "", services_offered: ["Shelter / Place of Safety"], services_offered_other: "", contact_person: form.contact_person || "", phone: form.phone || "", email: form.email || "", address: form.address || "", operating_area: form.operating_area || "", status: form.status || "Active" }
  if (view === "partners-in-district") return { district: form.district, partner_name: form.partner_name || "", partner_type: form.partner_type || "", partner_type_other: form.partner_type === "Other" ? form.partner_type_other || "" : "", services_offered: form.services_offered || [], services_offered_other: form.services_offered?.includes("Other") ? form.services_offered_other || "" : "", contact_person: form.contact_person || "", phone: form.phone || "", email: form.email || "", address: form.address || "", operating_area: form.operating_area || "", status: form.status || "Active" }
  return { district: form.district, court_name: form.court_name || "", court_type: form.court_type || "", court_type_other: form.court_type === "Other" ? form.court_type_other || "" : "", contact_person: form.contact_person || "", phone: form.phone || "", email: form.email || "", physical_address: form.physical_address || "", status: form.status || "Active" }
}

function referencePreserveForSetup(view: string, record: SetupRecord): ReferenceDataPreserve {
  if (view === "provinces" && record.name) return { provinces: [record as ProvinceOption] }
  if (view === "districts" && record.name) return { districts: [record as DistrictOption] }
  if (view === "district-wards" && record.name && record.district) return { wards: [record as WardOption] }
  if (view === "relationship-types" && record.name) return { relationshipTypes: [record as RelationshipTypeOption] }
  return {}
}

function SetupForm({ view, form, setFormValue, provinces, districts, wards, lockedProvince, lockedDistrict, readOnly }: { view: string; form: SetupRecord; setFormValue: (key: keyof SetupRecord, value: string | number | null | string[]) => void; provinces: ProvinceOption[]; districts: DistrictOption[]; wards: WardOption[]; lockedProvince: boolean; lockedDistrict: boolean; readOnly: boolean }) {
  const disabledClass = `${inputClass} disabled:bg-[#eef2f5] disabled:text-[#8aa0bf]`
  const needsProvince = view === "districts" || view === "district-wards"
  const needsDistrict = !["provinces", "relationship-types"].includes(view)
  return (
    <FormGrid>
      {view === "provinces" && <><Field label="Province name"><input className={inputClass} disabled={readOnly} value={form.name || ""} onChange={(event) => setFormValue("name", event.target.value)} /></Field><Field label="Code"><input className={inputClass} disabled={readOnly} value={form.code || ""} onChange={(event) => setFormValue("code", event.target.value)} /></Field></>}
      {view === "relationship-types" && <><Field label="Relationship name" required><input className={inputClass} disabled={readOnly} value={form.name || ""} onChange={(event) => setFormValue("name", event.target.value)} /></Field><div className="md:col-span-2"><Field label="Description"><textarea className={`${inputClass} min-h-[90px] py-3`} disabled={readOnly} value={form.description || ""} onChange={(event) => setFormValue("description", event.target.value)} /></Field></div></>}
      {needsProvince && <Field label="Province"><select className={disabledClass} disabled={readOnly || lockedProvince} value={form.province || ""} onChange={(event) => setFormValue("province", Number(event.target.value) || null)}><option value="">Select province</option>{provinces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
      {view === "districts" && <><Field label="District name" required><input className={inputClass} disabled={readOnly} value={form.name || ""} onChange={(event) => setFormValue("name", event.target.value)} /></Field><Field label="District code (2 or 3 letters)" required><input className={inputClass} disabled={readOnly} value={form.code || ""} maxLength={3} pattern="[A-Za-z]{2,3}" placeholder="e.g. GR or HRE" onChange={(event) => setFormValue("code", event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))} /></Field></>}
      {needsDistrict && view !== "districts" && <Field label="District"><select className={disabledClass} disabled={readOnly || lockedDistrict} value={form.district || ""} onChange={(event) => setFormValue("district", Number(event.target.value) || null)}><option value="">Select district</option>{districts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
      {view === "district-wards" && <><Field label="Ward name or number"><input className={inputClass} disabled={readOnly} value={form.name || ""} onChange={(event) => setFormValue("name", event.target.value)} /></Field><Field label="Description"><input className={inputClass} disabled={readOnly} value={form.description || ""} onChange={(event) => setFormValue("description", event.target.value)} /></Field></>}
      {view === "ccws" && <Field label="Base ward"><select className={inputClass} disabled={readOnly} value={form.ward || ""} onChange={(event) => setFormValue("ward", Number(event.target.value) || null)}><option value="">No base ward selected</option>{wards.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
      {view === "ccws" && <><Field label="Username" required><input className={inputClass} disabled={readOnly} value={form.username || ""} onChange={(event) => setFormValue("username", event.target.value)} autoComplete="off" /></Field><Field label="Temporary password" required={!form.userId}><input className={inputClass} type="password" disabled={readOnly} value={form.password || ""} onChange={(event) => setFormValue("password", event.target.value)} autoComplete="new-password" placeholder={form.userId ? "Leave blank to keep current password" : ""} /></Field><Field label="Full name"><input className={inputClass} disabled={readOnly} value={form.full_name || ""} onChange={(event) => setFormValue("full_name", event.target.value)} /></Field><Field label="National ID"><input className={inputClass} disabled={readOnly} value={form.national_id || ""} onChange={(event) => setFormValue("national_id", event.target.value)} /></Field><Field label="Gender"><select className={inputClass} disabled={readOnly} value={form.gender || ""} onChange={(event) => setFormValue("gender", event.target.value)}><option value="">Select gender</option>{["Female", "Male", "Other"].map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Phone"><input className={inputClass} disabled={readOnly} value={form.phone || ""} onChange={(event) => setFormValue("phone", event.target.value)} /></Field><Field label="Email"><input className={inputClass} disabled={readOnly} value={form.email || ""} onChange={(event) => setFormValue("email", event.target.value)} /></Field><Field label="Physical address"><input className={inputClass} disabled={readOnly} value={form.physical_address || ""} onChange={(event) => setFormValue("physical_address", event.target.value)} /></Field><Field label="Date registered"><input type="date" className={inputClass} disabled={readOnly} value={form.date_registered || ""} onChange={(event) => setFormValue("date_registered", event.target.value)} /></Field>{form.mustChangePassword !== undefined && <ReadonlyField label="Password status" value={form.mustChangePassword ? "Temporary password - change required" : "Password changed by CCW"} />}</>}
      {view === "places" && <>
        <Field label="Place of safety name" required><input className={inputClass} disabled={readOnly} value={form.partner_name || ""} onChange={(event) => setFormValue("partner_name", event.target.value)} /></Field>
        <Field label="Contact person"><input className={inputClass} disabled={readOnly} value={form.contact_person || ""} onChange={(event) => setFormValue("contact_person", event.target.value)} /></Field>
        <Field label="Phone"><input className={inputClass} disabled={readOnly} value={form.phone || ""} onChange={(event) => setFormValue("phone", event.target.value)} /></Field>
        <Field label="Email"><input className={inputClass} disabled={readOnly} value={form.email || ""} onChange={(event) => setFormValue("email", event.target.value)} /></Field>
        <Field label="Address"><input className={inputClass} disabled={readOnly} value={form.address || ""} onChange={(event) => setFormValue("address", event.target.value)} /></Field>
        <Field label="Operating area"><input className={inputClass} disabled={readOnly} value={form.operating_area || ""} onChange={(event) => setFormValue("operating_area", event.target.value)} /></Field>
      </>}
      {view === "partners-in-district" && <>
        <Field label="Partner name"><input className={inputClass} disabled={readOnly} value={form.partner_name || ""} onChange={(event) => setFormValue("partner_name", event.target.value)} /></Field>
        <Field label="Partner type"><select className={inputClass} disabled={readOnly} value={form.partner_type || ""} onChange={(event) => setFormValue("partner_type", event.target.value)}><option value="">Select type</option>{partnerTypeOptions.map((item) => <option key={item}>{item}</option>)}</select></Field>
        {form.partner_type === "Other" && <Field label="Specify partner type"><input className={inputClass} disabled={readOnly} value={form.partner_type_other || ""} onChange={(event) => setFormValue("partner_type_other", event.target.value)} /></Field>}
        <Field label="Contact person"><input className={inputClass} disabled={readOnly} value={form.contact_person || ""} onChange={(event) => setFormValue("contact_person", event.target.value)} /></Field>
        <Field label="Phone"><input className={inputClass} disabled={readOnly} value={form.phone || ""} onChange={(event) => setFormValue("phone", event.target.value)} /></Field>
        <Field label="Email"><input className={inputClass} disabled={readOnly} value={form.email || ""} onChange={(event) => setFormValue("email", event.target.value)} /></Field>
        <Field label="Address"><input className={inputClass} disabled={readOnly} value={form.address || ""} onChange={(event) => setFormValue("address", event.target.value)} /></Field>
        <Field label="Operating area"><input className={inputClass} disabled={readOnly} value={form.operating_area || ""} onChange={(event) => setFormValue("operating_area", event.target.value)} /></Field>
        <Field label="Services offered"><select multiple className="min-h-[132px] w-full rounded-md border border-[#d8dee8] bg-white px-3 py-2 text-sm text-[#23364f] outline-none focus:border-[#008c7a] focus:ring-4 focus:ring-[#008c7a]/15" disabled={readOnly} value={form.services_offered || []} onChange={(event) => setFormValue("services_offered", Array.from(event.target.selectedOptions).map((item) => item.value))}>{serviceOptions.map((item) => <option key={item}>{item}</option>)}</select></Field>
        {form.services_offered?.includes("Other") && <Field label="Specify other service"><input className={inputClass} disabled={readOnly} value={form.services_offered_other || ""} onChange={(event) => setFormValue("services_offered_other", event.target.value)} /></Field>}
      </>}
      {view === "register-courts" && <>
        <Field label="Court name"><input className={inputClass} disabled={readOnly} value={form.court_name || ""} onChange={(event) => setFormValue("court_name", event.target.value)} /></Field>
        <Field label="Court type"><select className={inputClass} disabled={readOnly} value={form.court_type || ""} onChange={(event) => setFormValue("court_type", event.target.value)}><option value="">Select type</option>{courtTypeOptions.map((item) => <option key={item}>{item}</option>)}</select></Field>
        {form.court_type === "Other" && <Field label="Specify court type"><input className={inputClass} disabled={readOnly} value={form.court_type_other || ""} onChange={(event) => setFormValue("court_type_other", event.target.value)} /></Field>}
        <Field label="Contact person"><input className={inputClass} disabled={readOnly} value={form.contact_person || ""} onChange={(event) => setFormValue("contact_person", event.target.value)} /></Field>
        <Field label="Phone"><input className={inputClass} disabled={readOnly} value={form.phone || ""} onChange={(event) => setFormValue("phone", event.target.value)} /></Field>
        <Field label="Email"><input className={inputClass} disabled={readOnly} value={form.email || ""} onChange={(event) => setFormValue("email", event.target.value)} /></Field>
        <Field label="Physical address"><input className={inputClass} disabled={readOnly} value={form.physical_address || ""} onChange={(event) => setFormValue("physical_address", event.target.value)} /></Field>
      </>}
      <Field label="Status"><select className={inputClass} disabled={readOnly} value={form.status || "Active"} onChange={(event) => setFormValue("status", event.target.value)}><option>Active</option><option>Inactive</option></select></Field>
      {form.createdByName && <ReadonlyField label="Created by" value={form.createdByName} />}
      {form.updatedByName && <ReadonlyField label="Updated by" value={form.updatedByName} />}
    </FormGrid>
  )
}

type AuditLogRecord = {
  id: number
  actorName: string
  actorRole: string
  actorRoleLabel: string
  actorProvince: string
  actorDistrict: string
  action: string
  target_type: string
  target_reference: string
  metadata: Record<string, unknown>
  created_at: string
}

function Audit({ user }: { user: ApiUser }) {
  const [logs, setLogs] = useState<AuditLogRecord[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [moduleFilter, setModuleFilter] = useState("")
  const [actionFilter, setActionFilter] = useState("")
  const [severityFilter, setSeverityFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [districtFilter, setDistrictFilter] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [onlySuspicious, setOnlySuspicious] = useState(false)
  const [onlySensitive, setOnlySensitive] = useState(false)
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const isSystemAdmin = user.profile.role === "SYS_ADMIN"

  useEffect(() => {
    if (!isSystemAdmin) return
    apiGet<AuditLogRecord[]>("/audit-logs/")
      .then(setLogs)
      .catch(() => setLogs([]))
  }, [isSystemAdmin])

  function moduleName(log: AuditLogRecord) {
    const text = `${log.action} ${log.target_type}`.toLowerCase()
    if (text.includes("alert")) return "Alert"
    if (text.includes("intake") || text.includes("screening")) return "Intake"
    if (text.includes("assessment")) return "Assessment"
    if (text.includes("care plan")) return "Care Plan"
    if (text.includes("closure")) return "Closure"
    if (text.includes("allocation") || text.includes("allocated")) return "Allocation"
    if (text.includes("user") || text.includes("role") || text.includes("password")) return "Security"
    return log.target_type || "System"
  }

  function actionName(log: AuditLogRecord) {
    const action = log.action.toLowerCase()
    if (action.includes("approved")) return "Approved"
    if (action.includes("rejected") || action.includes("reject")) return "Rejected"
    if (action.includes("submitted")) return "Submitted"
    if (action.includes("allocated")) return "Allocated"
    if (action.includes("requested")) return "Requested"
    if (action.includes("created")) return "Created"
    if (action.includes("saved") || action.includes("updated")) return "Updated"
    if (action.includes("opened") || action.includes("viewed")) return "Viewed"
    return log.action.split(":")[0]
  }

  function changeItems(log: AuditLogRecord) {
    const changed = Array.isArray(log.metadata?.changed) ? log.metadata.changed : []
    const fields = Array.isArray(log.metadata?.fields) ? log.metadata.fields : []
    return [...changed, ...fields].map((item) => objectValue(item)).filter((item) => item.path || item.label)
  }

  function isSensitive(log: AuditLogRecord) {
    const text = `${log.action} ${log.target_type} ${JSON.stringify(log.metadata)}`.toLowerCase()
    return ["child", "identity", "case_category", "risk_level", "closure", "role", "password", "allocated", "approved", "rejected"].some((item) => text.includes(item))
  }

  function severity(log: AuditLogRecord) {
    const text = `${log.action} ${log.target_type}`.toLowerCase()
    if (text.includes("role") || text.includes("delete") || text.includes("unauthorized")) return "Critical"
    if (text.includes("approved") || text.includes("rejected") || text.includes("closure") || isSensitive(log)) return "High"
    if (text.includes("submitted") || text.includes("allocated") || text.includes("requested")) return "Medium"
    return "Low"
  }

  function status(log: AuditLogRecord) {
    const text = log.action.toLowerCase()
    if (text.includes("rejected")) return "Closed"
    if (text.includes("approved")) return "Reviewed"
    if (severity(log) === "Critical") return "Escalated"
    return "Open"
  }

  function isSuspicious(log: AuditLogRecord) {
    const hour = new Date(log.created_at).getHours()
    return severity(log) === "Critical" || hour < 6 || hour > 20 || log.action.toLowerCase().includes("failed")
  }

  function childRef(log: AuditLogRecord) {
    const ref = String(log.metadata?.child_id || log.metadata?.child || "")
    if (!ref) return "Masked"
    return `${ref.slice(0, 3)}***${ref.slice(-2)}`
  }

  const modules = Array.from(new Set(logs.map(moduleName))).sort()
  const actions = Array.from(new Set(logs.map(actionName))).sort()
  const districts = Array.from(new Set(logs.map((log) => log.actorDistrict).filter(Boolean))).sort()
  const visibleLogs = logs.filter((log) => {
    const haystack = [log.id, log.actorName, log.actorRoleLabel, log.actorProvince, log.actorDistrict, log.action, log.target_type, log.target_reference, JSON.stringify(log.metadata)].join(" ").toLowerCase()
    const created = new Date(log.created_at).getTime()
    return (!search.trim() || haystack.includes(search.trim().toLowerCase()))
      && (!moduleFilter || moduleName(log) === moduleFilter)
      && (!actionFilter || actionName(log) === actionFilter)
      && (!severityFilter || severity(log) === severityFilter)
      && (!statusFilter || status(log) === statusFilter)
      && (!districtFilter || log.actorDistrict === districtFilter)
      && (!dateFrom || created >= new Date(`${dateFrom}T00:00:00`).getTime())
      && (!dateTo || created <= new Date(`${dateTo}T23:59:59`).getTime())
      && (!onlySuspicious || isSuspicious(log))
      && (!onlySensitive || isSensitive(log))
  })
  const pageCount = Math.max(1, Math.ceil(visibleLogs.length / rowsPerPage))
  const safePage = Math.min(page, pageCount)
  const pageRows = visibleLogs.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage)
  const pageStart = visibleLogs.length ? (safePage - 1) * rowsPerPage + 1 : 0
  const pageEnd = Math.min(visibleLogs.length, safePage * rowsPerPage)
  const selected = logs.find((log) => log.id === selectedId)

  useEffect(() => setPage(1), [search, moduleFilter, actionFilter, severityFilter, statusFilter, districtFilter, dateFrom, dateTo, onlySuspicious, onlySensitive, rowsPerPage])

  function clearFilters() {
    setSearch("")
    setModuleFilter("")
    setActionFilter("")
    setSeverityFilter("")
    setStatusFilter("")
    setDistrictFilter("")
    setDateFrom("")
    setDateTo("")
    setOnlySuspicious(false)
    setOnlySensitive(false)
  }

  if (!isSystemAdmin) {
    return <Panel title="Audit Trail" icon={Lock} action="System Admin only"><div className="rounded-md border border-[#f4b4ac] bg-[#fff7f5] p-5 text-sm font-semibold text-[#b42318]">Only the National System Administrator can access the audit trail.</div></Panel>
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MiniCard title="Total Audit Events" value={`${logs.length}`} icon={History} />
        <MiniCard title="Sensitive Changes" value={`${logs.filter(isSensitive).length}`} icon={ShieldAlert} />
        <MiniCard title="High / Critical Events" value={`${logs.filter((log) => ["High", "Critical"].includes(severity(log))).length}`} icon={AlertTriangle} />
        <MiniCard title="Suspicious Activity" value={`${logs.filter(isSuspicious).length}`} icon={Lock} />
        <MiniCard title="Pending Review" value={`${logs.filter((log) => status(log) === "Open").length}`} icon={Clock3} />
        <MiniCard title="Failed Login Attempts" value={`${logs.filter((log) => log.action.toLowerCase().includes("failed")).length}`} icon={X} />
        <MiniCard title="Approved Data Changes" value={`${logs.filter((log) => log.action.toLowerCase().includes("approved")).length}`} icon={CheckCircle2} />
        <MiniCard title="Rejected Data Changes" value={`${logs.filter((log) => log.action.toLowerCase().includes("rejected")).length}`} icon={X} />
      </section>

      <Panel title="National Audit Trail" icon={History} action={`${visibleLogs.length} events`}>
        <div className="mb-4 rounded-md border border-[#d8dee8] bg-[#fbfdff] p-3">
          <div className="grid items-center gap-3 md:grid-cols-[1fr_minmax(280px,520px)_auto_auto]">
            <span className="hidden md:block" />
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
              <input className={`${inputClass} h-10 pl-9`} placeholder="Search case, user, action, role, district..." value={search} onChange={(event) => setSearch(event.target.value)} />
            </span>
            <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#d8dee8] bg-white px-3 text-sm font-semibold text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]" onClick={() => setFiltersOpen((open) => !open)}>
              <Settings className="h-4 w-4" /> Filters
              <ChevronDown className={`h-4 w-4 transition ${filtersOpen ? "rotate-180" : ""}`} />
            </button>
            <button className="h-10 rounded-md border border-[#d8dee8] bg-white px-3 text-sm font-bold text-[#263747] hover:border-[#008c7a]" onClick={clearFilters}>Clear</button>
          </div>
          {filtersOpen && <div className="mt-3 grid gap-3 border-t border-[#d8dee8] pt-3 sm:grid-cols-2 xl:grid-cols-5">
            <AuditSelect label="Module" value={moduleFilter} options={modules} onChange={setModuleFilter} />
            <AuditSelect label="Action" value={actionFilter} options={actions} onChange={setActionFilter} />
            <AuditSelect label="Severity" value={severityFilter} options={["Low", "Medium", "High", "Critical"]} onChange={setSeverityFilter} />
            <AuditSelect label="Status" value={statusFilter} options={["Open", "Reviewed", "Escalated", "Closed"]} onChange={setStatusFilter} />
            <AuditSelect label="District" value={districtFilter} options={districts} onChange={setDistrictFilter} />
            <label className="grid gap-1 text-sm font-semibold text-[#263747]"><span>Date from</span><input className={`${inputClass} h-10`} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
            <label className="grid gap-1 text-sm font-semibold text-[#263747]"><span>Date to</span><input className={`${inputClass} h-10`} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
            <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-[#263747]"><input type="checkbox" checked={onlySuspicious} onChange={(event) => setOnlySuspicious(event.target.checked)} /> Only suspicious</label>
            <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-[#263747]"><input type="checkbox" checked={onlySensitive} onChange={(event) => setOnlySensitive(event.target.checked)} /> Only sensitive</label>
          </div>}
        </div>
        <div className="overflow-hidden rounded-md border border-[#d8dee8] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1500px] border-collapse text-left text-sm">
              <thead className="bg-[#f8fafc] text-[#2e6fa3]"><tr>{["Audit ID", "Date/Time", "User", "Role", "Office Level", "Module", "Action", "Record Ref", "Child Ref", "Severity", "Status", "IP / Device"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
              <tbody>
                {pageRows.length ? pageRows.map((log) => (
                  <tr key={log.id} className="cursor-pointer bg-white hover:bg-[#f8fafc]" onClick={() => setSelectedId(log.id)}>
                    <td className="border-b border-[#edf0f4] px-3 py-3 font-bold text-[#30528c]">AUD-{String(log.id).padStart(6, "0")}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{formatWorkflowDateTime(log.created_at)}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{log.actorName}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{log.actorRoleLabel || log.actorRole}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{log.actorDistrict ? `District: ${log.actorDistrict}` : log.actorProvince ? `Province: ${log.actorProvince}` : "National"}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{moduleName(log)}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{actionName(log)}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{log.target_reference || "-"}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">{childRef(log)}</td>
                    <td className="border-b border-[#edf0f4] px-3 py-3"><AuditSeverityBadge value={severity(log)} /></td>
                    <td className="border-b border-[#edf0f4] px-3 py-3"><StatusBadge status={status(log)} /></td>
                    <td className="border-b border-[#edf0f4] px-3 py-3">Not captured</td>
                  </tr>
                )) : <tr><td className="px-4 py-8 text-center text-[#64748b]" colSpan={12}>No audit events match the selected filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <TablePagination totalRows={visibleLogs.length} pageStart={pageStart} pageEnd={pageEnd} rowsPerPage={rowsPerPage} setRowsPerPage={setRowsPerPage} page={safePage} pageCount={pageCount} setPage={setPage} />
        </div>
      </Panel>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[#102033]/45">
          <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-[#d8dee8] bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[#d8dee8] bg-white px-5 py-4">
              <div>
                <div className="text-xs font-bold uppercase text-[#64748b]">Audit Summary</div>
                <h3 className="mt-1 text-xl font-bold text-[#263747]">AUD-{String(selected.id).padStart(6, "0")}</h3>
              </div>
              <button className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#263747] hover:border-[#008c7a] hover:text-[#008c7a]" onClick={() => setSelectedId(null)}>x</button>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid gap-3 md:grid-cols-2">
                <Info label="Date/time" value={formatWorkflowDateTime(selected.created_at)} />
                <Info label="User" value={selected.actorName} />
                <Info label="Role" value={selected.actorRoleLabel || selected.actorRole} />
                <Info label="Office" value={selected.actorDistrict || selected.actorProvince || "National"} />
                <Info label="Module" value={moduleName(selected)} />
                <Info label="Action" value={selected.action} />
                <Info label="Record affected" value={selected.target_reference || "-"} />
                <Info label="Severity" value={severity(selected)} />
              </div>
              <section className="rounded-md border border-[#d8dee8] bg-white">
                <div className="border-b border-[#d8dee8] bg-[#f8fafc] px-3 py-2 text-sm font-bold text-[#263747]">Change Details</div>
                {changeItems(selected).length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                      <thead className="text-[#2e6fa3]"><tr>{["Field", "Previous Value", "New Value"].map((head) => <th key={head} className="border-b border-[#d8dee8] px-3 py-3">{head}</th>)}</tr></thead>
                      <tbody>{changeItems(selected).map((item, index) => <tr key={`${item.path || item.label}-${index}`}><td className="border-b border-[#edf0f4] px-3 py-3 font-bold">{String(item.label || item.path)}</td><td className="border-b border-[#edf0f4] px-3 py-3">{String(item.from || item.current_value || item.old_value || "Not captured")}</td><td className="border-b border-[#edf0f4] px-3 py-3 text-[#007464]">{String(item.to || item.proposed_value || item.new_value || "Not captured")}</td></tr>)}</tbody>
                    </table>
                  </div>
                ) : <div className="p-3 text-sm text-[#64748b]">No field-level change items captured for this event.</div>}
              </section>
              <Info label="Reason / Justification" value={String(selected.metadata?.reason || selected.metadata?.notes || "Not captured")} />
              <section className="rounded-md border border-[#d8dee8] bg-[#f8fafc] p-3">
                <div className="mb-2 text-sm font-bold text-[#263747]">Approval Trail</div>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between gap-3"><span>Event recorded</span><span>{selected.actorName} | {formatWorkflowDateTime(selected.created_at)}</span></div>
                  {String(selected.action).toLowerCase().includes("approved") && <div className="flex justify-between gap-3"><span>Reviewed</span><span>Approved</span></div>}
                  {String(selected.action).toLowerCase().includes("rejected") && <div className="flex justify-between gap-3"><span>Reviewed</span><span>Rejected</span></div>}
                </div>
              </section>
              <section className="rounded-md border border-[#d8dee8] bg-white p-3">
                <div className="mb-2 text-sm font-bold text-[#263747]">Technical Details</div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Info label="IP address" value="Not captured" />
                  <Info label="Browser/device" value="Not captured" />
                  <Info label="Session ID" value="Not captured" />
                  <Info label="Login method" value="Not captured" />
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function AuditSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-[#263747]">
      <span>{label}</span>
      <select className={`${inputClass} h-10`} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  )
}

function AuditSeverityBadge({ value }: { value: string }) {
  const className = value === "Critical" ? "bg-[#fee4e2] text-[#b42318]" : value === "High" ? "bg-[#fff4d6] text-[#a05b16]" : value === "Medium" ? "bg-[#e7f0fb] text-[#2e6fa3]" : "bg-[#e7f6f3] text-[#007464]"
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${className}`}>{value}</span>
}

function Setup({
  users,
  organizations,
  provinces,
  districts,
  wards,
  refreshUsers,
  refreshReferenceData,
}: {
  users: ApiUser[]
  organizations: OrganizationOption[]
  provinces: ProvinceOption[]
  districts: DistrictOption[]
  wards: WardOption[]
  refreshUsers: (preserve?: ApiUser[]) => Promise<ApiUser[]>
  refreshReferenceData: (preserve?: ReferenceDataPreserve) => Promise<{ provinceData: ProvinceOption[]; districtData: DistrictOption[]; wardData: WardOption[]; organizationData: OrganizationOption[]; relationshipTypeData: RelationshipTypeOption[] }>
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
    ["DISTRICT_HEAD", "DSDO - internal"],
    ["DSDO", "SDO - internal"],
    ["CCW", "CCW - public portal"],
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
  const [deleteTarget, setDeleteTarget] = useState<ApiUser | null>(null)
  const [deletingUser, setDeletingUser] = useState(false)
  const [error, setError] = useState("")
  const preservedUsersRef = useRef<ApiUser[]>([])
  // A deleted account must never be restored by an older in-flight user-list
  // response. Keep its ID excluded until the component is unmounted.
  const deletedUserIdsRef = useRef<Set<number>>(new Set())
  const districtId = Number(form.district) || null
  const provinceId = Number(form.province) || null
  const nationalRoles = ["SYS_ADMIN", "DEPUTY_DIRECTOR", "DIRECTOR", "PROGRAMME_OFFICER"]
  const provinceOnlyRoles = ["PROVINCIAL_HEAD"]
  const geographyDisabled = nationalRoles.includes(form.role)
  // A district is always selected within a province.  Keeping this disabled
  // until a province is chosen prevents an unrelated district being assigned.
  const districtDisabled = geographyDisabled || provinceOnlyRoles.includes(form.role) || !provinceId
  const wardDisabled = districtDisabled || !districtId
  const filteredDistricts = provinceId ? districts.filter((item) => Number(item.province) === provinceId) : districts
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

  function setProvince(value: string) {
    setForm((current) => ({
      ...current,
      province: value,
      district: "",
      ward: "",
    }))
  }

  function setDistrict(value: string) {
    const district = districts.find((item) => item.id === Number(value))
    setForm((current) => ({
      ...current,
      province: district ? String(district.province) : current.province,
      district: value,
      ward: "",
    }))
  }

  function openCreateModal() {
    setForm(emptyUserForm)
    setEditingUser(null)
    setModalMode("create")
    setError("")
    setMessage("")
    setSuccessDialog(null)
    void refreshReferenceData().catch((err) => setError(err instanceof Error ? err.message : "Could not refresh province and district lists."))
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
    void refreshReferenceData().catch((err) => setError(err instanceof Error ? err.message : "Could not refresh province and district lists."))
  }

  function closeModal() {
    setModalMode(null)
    setEditingUser(null)
    setError("")
  }

  async function saveUser() {
    setError("")
    setMessage("")
    if (["DISTRICT_HEAD", "DSDO", "CCW"].includes(form.role) && !form.district) {
      setError("District is required for this role.")
      return
    }
    if (form.role === "PROVINCIAL_HEAD" && !form.province) {
      setError("Province is required for this role.")
      return
    }
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
      preservedUsersRef.current = upsertById(preservedUsersRef.current, savedUser, true)
      setTableUsers((current) => upsertById(current, savedUser, !wasEditing))
      const refreshedUsers = await refreshUsers([savedUser])
      setTableUsers(mergeById(refreshedUsers, [savedUser], !wasEditing))
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

  async function deleteUser() {
    if (!deleteTarget || deletingUser) return
    setDeletingUser(true)
    setError("")
    try {
      await apiDelete(`/users/${deleteTarget.id}/`)
      deletedUserIdsRef.current.add(deleteTarget.id)
      preservedUsersRef.current = preservedUsersRef.current.filter((item) => item.id !== deleteTarget.id)
      setTableUsers((current) => current.filter((item) => item.id !== deleteTarget.id))
      const refreshedUsers = await refreshUsers()
      setTableUsers(refreshedUsers.filter((item) => !deletedUserIdsRef.current.has(item.id)))
      setDeleteTarget(null)
      setSuccessDialog({ title: "User deleted", detail: `${deleteTarget.username} has been permanently deleted.` })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete user.")
    } finally {
      setDeletingUser(false)
    }
  }

  useEffect(() => {
    setPage(1)
  }, [roleFilter, rowsPerPage])

  useEffect(() => {
    setTableUsers(mergeById(users, preservedUsersRef.current, true).filter((item) => !deletedUserIdsRef.current.has(item.id)))
  }, [users])

  return (
    <Panel title="User Management" icon={Users}>
      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <MiniCard title="Roles" value="National, Provincial Head, DSDO, SDO, CCW" icon={Shield} />
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
                <td className="px-3 py-3"><div className="flex items-center gap-2">
                  <button className="grid h-9 w-9 place-items-center rounded-md border border-[#d8dee8] bg-white text-[#2e6fa3] hover:border-[#008c7a] hover:text-[#008c7a]" title={`Edit ${item.username}`} onClick={() => openEditModal(item)}>
                    <PencilLine className="h-4 w-4" />
                  </button>
                  <button className="grid h-9 w-9 place-items-center rounded-md border border-[#f4b4ac] bg-white text-[#b42318] hover:bg-[#fff7f5]" title={`Delete ${item.username}`} onClick={() => { setDeleteTarget(item); setError("") }}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div></td>
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
                <select className={`${inputClass} disabled:bg-[#eef2f5] disabled:text-[#8aa0bf]`} value={form.province} onChange={(event) => setProvince(event.target.value)} disabled={geographyDisabled}>
                  <option value="">All provinces</option>
                  {provinces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <Field label="District">
                <select className={`${inputClass} disabled:bg-[#eef2f5] disabled:text-[#8aa0bf]`} value={form.district} onChange={(event) => setDistrict(event.target.value)} disabled={districtDisabled}>
                  <option value="">{!provinceId ? "Select a province first" : filteredDistricts.length ? "Select district" : "No districts available for this province"}</option>
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
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-[#102033]/55 p-4">
          <div className="w-full max-w-md rounded-md border border-[#f4b4ac] bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#fff1ef] text-[#b42318]"><AlertTriangle className="h-6 w-6" /></div>
              <div><h3 className="text-lg font-bold text-[#263747]">Delete user?</h3><p className="mt-2 text-sm leading-6 text-[#50617a]">Are you sure you want to permanently delete <strong>{deleteTarget.username}</strong>{deleteTarget.first_name || deleteTarget.last_name ? ` (${[deleteTarget.first_name, deleteTarget.last_name].filter(Boolean).join(" ")})` : ""}? This cannot be undone.</p></div>
            </div>
            {error && <div className="mt-4"><ErrorBanner message={error} /></div>}
            <div className="mt-6 flex justify-end gap-3">
              <button className="h-10 rounded-md border border-[#d8dee8] bg-white px-4 text-sm font-semibold text-[#263747]" disabled={deletingUser} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="h-10 rounded-md bg-[#b42318] px-4 text-sm font-semibold text-white hover:bg-[#8f1d14] disabled:cursor-not-allowed disabled:opacity-60" disabled={deletingUser} onClick={() => void deleteUser()}>{deletingUser ? "Deleting..." : "Delete user"}</button>
            </div>
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
