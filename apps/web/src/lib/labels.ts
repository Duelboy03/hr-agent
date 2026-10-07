export const TOOL_LABEL: Record<string, string> = {
  get_my_profile: 'Looked up your profile',
  get_leave_balance: 'Checked leave balance',
  list_my_leave_requests: 'Listed your leave requests',
  check_leave_request: 'Checked the leave request',
  submit_leave_request: 'Submit leave request',
  cancel_leave_request: 'Cancel leave request',
  get_latest_payslip: 'Fetched latest payslip',
  get_company_holidays: 'Looked up company holidays',
  search_policy: 'Searched the handbook',
  get_team_availability: 'Checked who is away',
  list_pending_approvals: 'Listed pending approvals',
  decide_leave_request: 'Decide on leave request',
}
export const label = (tool: string) => TOOL_LABEL[tool] ?? tool.replace(/_/g, ' ')

export const SUGGESTIONS: Record<string, string[]> = {
  meera: ['How many vacation days do I have left?', 'Book vacation from Dec 14 to Dec 16', 'Show me my latest payslip', 'Cancel my pending vacation request', 'Am I allowed to paste customer data into ChatGPT?', 'I want tomorrow off'],
  arjun: ['What is waiting for my approval?', "Approve Meera's request", 'Who is out next week?', 'Approve Zoe\'s request', 'How is overtime calculated?'],
  priya: ['What is waiting for my approval?', "Approve Zoe's request", 'Which company holidays are coming up?', 'Show me my latest payslip'],
}
