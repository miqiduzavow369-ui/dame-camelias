// Isolated City diary diagnostic. A snapshot is never publication permission.
export function assessDiaryConnection(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return {ready:false,reason:"connection_unavailable"};
  if (snapshot.domainChanged===true) return {ready:false,reason:"domain_changed"};
  if (snapshot.profileConfirmed!==true) return {ready:false,reason:"profile_not_confirmed"};
  if (snapshot.currentVersionVerified!==true) return {ready:false,reason:"version_unverified"};
  if (snapshot.identityVerified!==true) return {ready:false,reason:"identity_unverified"};
  if (snapshot.ownerApproved!==true) return {ready:false,reason:"approval_unverified"};
  return {ready:true,reason:"diagnostics_passed",publicationAuthorized:false};
}
