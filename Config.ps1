# =====================================================================
#  Computer Inventory Collector - Configuration
#  Edit the values below, then keep this file in the SAME folder as
#  CollectComputerData.ps1 - it is loaded automatically every run.
#
#  SECURITY NOTE: the password below is stored in PLAIN TEXT on every
#  PC this folder is copied to. Anyone who opens this file, or copies
#  this folder, can read it. Only do this on a trusted internal network.
#  If you'd rather not store a superuser password on every PC, create an
#  ordinary account in the "users" collection instead (see README) and
#  set AuthCollection to "users" below - a leaked password there only
#  exposes this one collection, not your whole PocketBase instance.
# =====================================================================

$PocketBaseUrl   = "http://192.168.5.32/pocketbase"
$AuthCollection  = "_superusers"
$DataCollection  = "computer_inventory"
$ServiceEmail    = "service@itconnect.internal"
$ServicePassword = "PUT_PASSWORD_HERE"
