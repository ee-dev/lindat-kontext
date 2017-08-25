# coding=utf-8
"""
    Authentication and authorization based on Federated login (Shibboleth) and
    limited local user support.

    This auth is not generic enough to be called ShibbolethAuth because it uses
    specific database backed etc.

"""
import logging
import os
import plugins
from plugins.abstract.auth import AbstractSemiInternalAuth
from plugins.abstract import PluginException

_logger = logging.getLogger(__name__)


class FederatedAuthWithFailover(AbstractSemiInternalAuth):
    """
        A Shibboleth authentication module with a failover
        solution. Please note that the failover solution should be
        used only in exceptional cases because no high security
        measures have been applied (as opposed to federated login).
    """
    ID_KEYS = ('HTTP_EPPN', 'HTTP_PERSISTENT_ID', 'HTTP_MAIL')
    RESERVED_USER = '__user_count'

    def get_user_info(self, user_id):
        raise NotImplementedError()

    def __init__(self, public_corplist, db, sessions, conf, failover):
        """

        Arguments:
            public_corplist -- default public corpora list
            db_provider -- default database
            sessions -- a session plugin

        Note:
            login_url - used e.g., in dialog ``
        """
        anonymous_id = int(conf['anonymous_user_id'])
        super(FederatedAuthWithFailover, self).__init__(anonymous_id=anonymous_id)
        self._db = db
        self._sessions = sessions
        self._public_corplist = public_corplist
        self._failover_auth = failover
        self._logout_url = conf['logout_url']

    def validate_user(self, plugin_api, username, password):
        """
            Try to find the user using two methods.
        """
        if username is not None and 0 < len(username):
            if username in FederatedAuthWithFailover.RESERVED_USER:
                _logger.warn("Reserved username used [%s]!", username)
                return self.anonymous_user()
            user_d = self._failover_auth.auth(self._db, username, password)
        else:
            user_d = self._auth(plugin_api)

        if user_d is not None:
            user_id = int(user_d["id"])
            return {
                'id': user_id,
                'user': user_d.get("username", "unknown"),
                'fullname': user_d.get("fullname", "Mr. No Name")
            }

        return self.anonymous_user()

    def get_logout_url(self, return_url=None):
        return self._logout_url

    def logout(self, session):
        self._sessions.delete(session)
        session.clear()

    def permitted_corpora(self, user_id):
        # TODO(jm) based on user_id
        return self._public_corplist

    def is_administrator(self, user_id):
        # TODO(jm)
        return False

    def logout_hook(self, plugin_api):
        plugin_api.redirect('%sfirst_form' % (plugin_api.root_url,))

    def _new_user_id(self):
        return self._db.incr(FederatedAuthWithFailover.RESERVED_USER)

    def _auth(self, plugin_api):
        """
            Inspect HTTP headers and try to find a shibboleth user.
        """
        username = _get_non_empty_header(plugin_api.get_environ, *FederatedAuthWithFailover.ID_KEYS)
        if username is None or username == FederatedAuthWithFailover.RESERVED_USER:
            return None

        firstname = _get_non_empty_header(
            plugin_api.get_environ, 'HTTP_GIVENNAME')
        surname = _get_non_empty_header(
            plugin_api.get_environ, 'HTTP_SN')
        displayname = _get_non_empty_header(
            plugin_api.get_environ, 'HTTP_DISPLAYNAME', 'HTTP_CN')

        # this will work most of the times but very likely not
        # always (no unification in what IdPs are sending)
        if not firstname and not surname:
            names = displayname.split()
            firstname = u" ".join(names[:-1])
            surname = names[-1]
        firstname = firstname or ""
        surname = surname or ""

        idp = _get_non_empty_header(
            plugin_api.get_environ, "HTTP_SHIB_IDENTITY_PROVIDER")

        db_user_d = self._db.hash_get_all(username)
        if db_user_d is None:
            user_d = {
                "id": self._new_user_id(),
                "username": username,
                "idp": idp,
                "fullname": u"%s %s" % (firstname, surname)
            }
            self._db.hash_set_map(username, user_d)
        else:
            if idp != db_user_d["idp"]:
                _logger.warn("User's [%s] idp has changed [%s]->[%s]",
                             username, idp, db_user_d["idp"])
                return None
            user_d = db_user_d

        return user_d


# =============================================================================

class LocalFailover(object):
    """
        Get user info from the underlying database.
    """
    min_pass = 5

    def __init__(self):
        pass

    def auth(self, db, user, password):
        d = db.hash_get_all(user)
        if 0 == len(d):
            return None
        p = d.get("password", "")
        if LocalFailover.min_pass > len(p):
            return None
        if p != password:
            return None
        del d["password"]
        d["username"] = user
        return d


# =============================================================================

def _load_corplist(corptree_path):
    """
        This auth relies on a list of corpora in a file
        from which we get the public ones. At the moment,
        all corpora in that file are considered public.

        Private can be added via user database.
    """
    from plugins.tree_corparch import CorptreeParser
    _, metadata = CorptreeParser().parse_xml_tree(corptree_path)
    return dict((k, k) for k in metadata.keys())


def _get_non_empty_header(ftor, *args):
    """
        Get values using the specified ftor. Empty or null values
        are treated as missing.
    """
    for header in args:
        val = ftor(header)
        if val is None or 0 == len(val):
            continue
        return val
    return None


# =============================================================================

@plugins.inject('db', 'sessions')
def create_instance(conf, db, sessions):
    auth_conf = conf.get('plugins', 'auth')
    corparch_conf = conf.get('plugins', 'corparch')
    corplist_file = corparch_conf['file']
    if not os.path.exists(corplist_file):
        raise PluginException("Corplist file [%s] in lindat_auth does not exist!" % corplist_file)
    public_corplist = _load_corplist(corplist_file)

    # use different shard for the user storage
    auth_db = db.get_instance('auth')

    # this can get handy when federated login is not possible
    failover_auth = LocalFailover()

    return FederatedAuthWithFailover(
        public_corplist=public_corplist,
        db=auth_db,
        sessions=sessions,
        conf=auth_conf,
        failover=failover_auth
    )
