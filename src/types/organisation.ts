export type OrganisationIndustry = "real_estate" | "ecommerce" | "general";

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  industry: OrganisationIndustry;
  created_at: string;
  updated_at: string;
}

export type OrganisationInsert = Pick<Organisation, "name" | "slug"> & {
  industry?: OrganisationIndustry;
};
export type OrganisationUpdate = Partial<Pick<Organisation, "name" | "slug" | "industry">>;

export type OrgRole = "admin" | "member";
export type MemberStatus = "active" | "invited" | "suspended";

export interface OrganisationMember {
  id: string;
  organisation_id: string;
  user_id: string | null;
  email: string;
  role: OrgRole;
  status: MemberStatus;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMemberRow extends OrganisationMember {
  display_name?: string | null;
  is_owner?: boolean;
}

