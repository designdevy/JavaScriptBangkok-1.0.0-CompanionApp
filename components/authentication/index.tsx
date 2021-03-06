/* eslint-disable @typescript-eslint/indent */
import { ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import rootContext from '../../commons/context.root';
import {
  FirestoreSnapshot,
  getEnvName,
  getFirebase,
  useFirebase,
  User
} from '../../commons/firebase';
import {
  CompletedFetchResult,
  FetchResult,
  isFetching,
  isFetchingCompleted
} from '../../interfaces/Commons';
import { registerTestCommand } from '../../commons/globals';
import { UserInfo } from '../../interfaces/Users';
import Loading from '../../commons/components/Loading';

export type ProfileData = {
  firstname: string;
  lastname: string;
  email: string;
  referenceCode: string;
  ticketType: string;
};

type AuthenticatedState = {
  profile: ProfileData;
  uid: string;
};

export type AuthenticationState = FetchResult<AuthenticatedState | null>;

/**
 * Returns the current authentication state.
 */
export function useAuthenticationState(): AuthenticationState {
  const firebaseFetchResult = useFirebase();
  const [firebaseUser, setFirebaseUser] = useState<User | null | 'loading'>(
    'loading'
  );
  const [profileSnapshot, setProfileSnapshot] = useState<
    FirestoreSnapshot | 'loading'
  >('loading');

  useEffect(() => {
    if (!isFetchingCompleted(firebaseFetchResult)) {
      return () => {};
    }
    const firebase = firebaseFetchResult.data;
    return firebase.auth().onAuthStateChanged(setFirebaseUser);
  }, [firebaseFetchResult]);

  useEffect(() => {
    if (!isFetchingCompleted(firebaseFetchResult)) {
      return () => {};
    }
    const firebase = firebaseFetchResult.data;
    if (firebaseUser === 'loading') {
      return () => {};
    }
    if (!firebaseUser) {
      setProfileSnapshot('loading');
      return () => {};
    }
    setProfileSnapshot('loading');
    return firebase
      .getEnvDoc()
      .collection('profiles')
      .doc(firebaseUser.uid)
      .onSnapshot(setProfileSnapshot);
  }, [firebaseFetchResult, firebaseUser]);

  if (firebaseUser === 'loading') {
    return { status: 'loading' };
  }
  if (!firebaseUser) {
    return { status: 'completed', data: null };
  }
  if (profileSnapshot === 'loading') {
    return { status: 'loading' };
  }
  if (!profileSnapshot.exists) {
    return { status: 'completed', data: null };
  }
  return {
    status: 'completed',
    data: {
      uid: firebaseUser.uid,
      profile: profileSnapshot.data() as UserInfo
    }
  };
}

export function isAuthenticated(
  state: AuthenticationState
): state is CompletedFetchResult<AuthenticatedState> {
  return isFetchingCompleted(state) && state.data !== null;
}

export async function logoutFromFirebase() {
  const firebase = await getFirebase();
  await firebase.auth().signOut();
}

/**
 * Returns an object with methods to authenticate user.
 */
export function useAuthenticationController() {
  return useMemo(
    () => ({
      async loginAsTestUser(ticketID: string) {
        if (getEnvName() === 'production') {
          throw new Error(
            'Eventpop authentication is not implemented yet. To log in, please run the app in test mode by appending ?env=test to URL'
          );
        }
        const firebase = await getFirebase();
        const getTestTokenFromApp = firebase
          .functions('asia-northeast1')
          .httpsCallable('getTestTokenFromApp');
        const token = await getTestTokenFromApp({ uid: ticketID });
        await firebase.auth().signInWithCustomToken(token.data.token);
      },
      async loginWithEventpop() {
        const firebase = await getFirebase();
        const url = `https://www.eventpop.me/oauth/authorize?${[
          'client_id=ba3bd8b639664043a8f1c3c6bef737620a84841d7e5a38aa84fdbf872920ab71',
          'redirect_uri=https://javascriptbangkok.com/1.0.0/eventpop_oauth_callback.html',
          'response_type=code'
        ].join('&')}`;
        const features =
          'width=720,height=480,location=1,resizable=1,statusbar=1,toolbar=0';
        const popup = window.open(url, '_blank', features);
        if (!popup) {
          throw new Error('Cannot open pop-up! Please check your ad-blocker.');
        }
        const code = await new Promise<string>((resolve, reject) => {
          const listener = (e: MessageEvent) => {
            if (
              e.origin === 'https://javascriptbangkok.com' &&
              typeof e.data === 'string' &&
              e.data.startsWith('?')
            ) {
              const { source } = e;
              const _code = e.data.match(/code=([^&]+)/)?.[1];
              resolve(_code);
              (source as any)?.postMessage(
                'close',
                'https://javascriptbangkok.com'
              );
              window.removeEventListener('message', listener);
            }
          };
          window.addEventListener('message', listener);
          const interval = setInterval(() => {
            if (popup.closed) {
              clearInterval(interval);
              reject(new Error('Pop-up is closed'));
            }
          }, 100);
        });
        const signInWithEventpop = firebase
          .functions('asia-northeast1')
          .httpsCallable('signInWithEventpop');
        const signInResponse = await signInWithEventpop({
          env: getEnvName(),
          code
        });
        const { result } = signInResponse.data;
        if (result.length === 0) {
          throw new Error('You do not have any registered ticket.');
        }
        const selectedTicket = (() => {
          if (result.length === 1) {
            return result[0];
          }
          const message = `You have multiple tickets. Please enter the number of the ticket you want to sign in with:\n\n${result
            .map((row: any, index: number) => {
              return `${index + 1}. ${row.profile.firstname} ${
                row.profile.lastname
              } [${row.profile.referenceCode}]`;
            })
            .join('\n')}`;
          for (;;) {
            // eslint-disable-next-line no-alert
            const answer = +(prompt(message) as any);
            if (answer && result[answer - 1]) {
              return result[answer - 1];
            }
          }
        })();
        await firebase
          .auth()
          .signInWithCustomToken(selectedTicket.firebaseToken);
      },
      async loginWithEventpopInfo(referenceCode: string, phoneNumber: string) {
        const firebase = await getFirebase();
        const signInWithEventpopInfo = firebase
          .functions('asia-northeast1')
          .httpsCallable('signInWithEventpopInfo');
        const signInResponse = await signInWithEventpopInfo({
          env: getEnvName(),
          referenceCode,
          phoneNumber
        });
        const { result } = signInResponse.data;
        if (result.length === 0) {
          throw new Error(
            'We did not find a valid ticket from your information provided.'
          );
        }
        const selectedTicket = (() => {
          if (result.length === 1) {
            return result[0];
          }
          const message = `You have multiple tickets. Please enter the number of the ticket you want to sign in with:\n\n${result
            .map((row: any, index: number) => {
              return `${index + 1}. ${row.profile.firstname} ${
                row.profile.lastname
              } [${row.profile.referenceCode}]`;
            })
            .join('\n')}`;
          for (;;) {
            // eslint-disable-next-line no-alert
            const answer = +(prompt(message) as any);
            if (answer && result[answer - 1]) {
              return result[answer - 1];
            }
          }
        })();
        await firebase
          .auth()
          .signInWithCustomToken(selectedTicket.firebaseToken);
      },
      async logout() {
        await logoutFromFirebase();
      }
    }),
    []
  );
}

function useIsClientSide() {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    setFlag(true);
  }, []);
  return flag;
}

/**
 * This component renders the children only if user is authenticated.
 * Otherwise, it requests the auth modal to be displayed.
 */
export function RequiresAuthentication(props: {
  children: ReactNode;
  fallback?: ReactNode;
  checking?: ReactNode;
}) {
  const {
    children,
    checking = <DefaultAuthenticationChecking />,
    fallback = null
  } = props;
  const authState = useAuthenticationState();
  const mustDisplayModal =
    !isFetching(authState) && !isAuthenticated(authState);
  const { authModalStore } = useContext(rootContext);

  useEffect(() => {
    if (!mustDisplayModal) {
      return () => {};
    }
    const modal = authModalStore.requestModal();
    return () => {
      modal.release();
    };
  }, [mustDisplayModal]);

  if (isFetching(authState)) {
    return <>{checking}</>;
  }
  if (!isAuthenticated(authState)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}

function DefaultAuthenticationChecking() {
  const isClientSide = useIsClientSide();
  return (
    <Loading
      message={isClientSide ? 'Checking authentication state' : 'Loading'}
      color='light'
    />
  );
}

export function withRequiredAuthentication<T>(
  BaseComponent: React.ComponentType<T>
): React.ComponentType<T> {
  return function Wrapped(props: T) {
    return (
      <RequiresAuthentication>
        {/* eslint-disable-next-line react/jsx-props-no-spreading */}
        <BaseComponent {...props} />
      </RequiresAuthentication>
    );
  };
}

registerTestCommand('logoutFromFirebase', logoutFromFirebase);
