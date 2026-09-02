export interface PbAdminDto {
  id: string;
  code: string;
  name: string;
  employeeId: string;
  createdAt: string;
  email?: string;
  title?: string;
  phone?: string;
  clientCount: number;
}

export interface PbAdminCreateInput {
  name: string;
  employeeId: string;
  password: string;
  email?: string;
  title?: string;
  phone?: string;
}

export interface PbAdminUpdateInput {
  name?: string;
  employeeId?: string;
  password?: string;
  email?: string;
  title?: string;
  phone?: string;
}
