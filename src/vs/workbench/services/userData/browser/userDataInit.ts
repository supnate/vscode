/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { AbstractInitializer } from 'vs/platform/userDataSync/common/abstractSynchronizer';
import { ExtensionsInitializer } from 'vs/platform/userDataSync/common/extensionsSync';
import { GlobalStateInitializer } from 'vs/platform/userDataSync/common/globalStateSync';
import { KeybindingsInitializer } from 'vs/platform/userDataSync/common/keybindingsSync';
import { SettingsInitializer } from 'vs/platform/userDataSync/common/settingsSync';
import { SnippetsInitializer } from 'vs/platform/userDataSync/common/snippetsSync';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IFileService } from 'vs/platform/files/common/files';
import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { UserDataSyncStoreClient } from 'vs/platform/userDataSync/common/userDataSyncStoreService';
import { IProductService } from 'vs/platform/product/common/productService';
import { IRequestService } from 'vs/platform/request/common/request';
import { CONFIGURATION_SYNC_STORE_KEY, IUserDataSyncStoreClient, SyncResource } from 'vs/platform/userDataSync/common/userDataSync';
import { URI } from 'vs/base/common/uri';
import { getCurrentAuthenticationSessionInfo } from 'vs/workbench/services/authentication/browser/authenticationService';
import { getSyncAreaLabel } from 'vs/workbench/services/userDataSync/common/userDataSync';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { isWeb } from 'vs/base/common/platform';

export const IUserDataInitializationService = createDecorator<IUserDataInitializationService>('IUserDataInitializationService');
export interface IUserDataInitializationService {
	_serviceBrand: any;

	initializeRequiredResources(): Promise<void>;
	initializeOtherResources(): Promise<void>;
	initializeExtensions(instantiationService: IInstantiationService): Promise<void>;
}

export class UserDataInitializationService implements IUserDataInitializationService {

	_serviceBrand: any;

	private readonly initialized: SyncResource[] = [];

	constructor(
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@IStorageService private readonly storageService: IStorageService,
		@IProductService private readonly productService: IProductService,
		@IRequestService private readonly requestService: IRequestService,
		@ILogService private readonly logService: ILogService
	) { }

	private _userDataSyncStoreClientPromise: Promise<IUserDataSyncStoreClient | undefined> | undefined;
	private createUserDataSyncStoreClient(): Promise<IUserDataSyncStoreClient | undefined> {
		if (!this._userDataSyncStoreClientPromise) {
			this._userDataSyncStoreClientPromise = (async (): Promise<IUserDataSyncStoreClient | undefined> => {
				if (!isWeb) {
					this.logService.trace(`Skipping initializing user data in desktop`);
					return;
				}

				if (!this.environmentService.options?.enableSyncByDefault) {
					this.logService.trace(`Skipping initializing user data as sync is not enabled by default`);
					return;
				}

				if (!this.storageService.isNew(StorageScope.GLOBAL)) {
					this.logService.trace(`Skipping initializing user data as application was opened before`);
					return;
				}

				if (!this.storageService.isNew(StorageScope.WORKSPACE)) {
					this.logService.trace(`Skipping initializing user data as workspace was opened before`);
					return;
				}

				const userDataSyncStore = this.productService[CONFIGURATION_SYNC_STORE_KEY];
				if (!userDataSyncStore) {
					this.logService.trace(`Skipping initializing user data as sync service is not provided`);
					return;
				}

				if (!this.environmentService.options?.credentialsProvider) {
					this.logService.trace(`Skipping initializing user data as credentials provider is not provided`);
					return;
				}

				let authenticationSession;
				try {
					authenticationSession = await getCurrentAuthenticationSessionInfo(this.environmentService, this.productService);
				} catch (error) {
					this.logService.error(error);
				}
				if (!authenticationSession) {
					this.logService.trace(`Skipping initializing user data as authentication session is not set`);
					return;
				}

				const userDataSyncStoreClient = new UserDataSyncStoreClient(URI.parse(userDataSyncStore.url), this.productService, this.requestService, this.logService, this.environmentService, this.fileService, this.storageService);
				userDataSyncStoreClient.setAuthToken(authenticationSession.accessToken, authenticationSession.providerId);
				return userDataSyncStoreClient;
			})();
		}

		return this._userDataSyncStoreClientPromise;
	}

	async initializeRequiredResources(): Promise<void> {
		return this.initialize([SyncResource.Settings, SyncResource.GlobalState]);
	}

	async initializeOtherResources(): Promise<void> {
		return this.initialize([SyncResource.Keybindings, SyncResource.Snippets]);
	}

	async initializeExtensions(instantiationService: IInstantiationService): Promise<void> {
		return this.initialize([SyncResource.Extensions], instantiationService);
	}

	private async initialize(syncResources: SyncResource[], instantiationService?: IInstantiationService): Promise<void> {
		const userDataSyncStoreClient = await this.createUserDataSyncStoreClient();
		if (!userDataSyncStoreClient) {
			return;
		}

		await Promise.all(syncResources.map(async syncResource => {
			try {
				if (this.initialized.includes(syncResource)) {
					this.logService.info(`${getSyncAreaLabel(syncResource)} initialized already.`);
					return;
				}
				this.initialized.push(syncResource);
				this.logService.trace(`Initializing ${getSyncAreaLabel(syncResource)}`);
				const initializer = this.createSyncResourceInitializer(syncResource, instantiationService);
				const userData = await userDataSyncStoreClient.read(syncResource, null);
				await initializer.initialize(userData);
				this.logService.info(`Initialized ${getSyncAreaLabel(syncResource)}`);
			} catch (error) {
				this.logService.info(`Error while initializing ${getSyncAreaLabel(syncResource)}`);
				this.logService.error(error);
			}
		}));
	}

	private createSyncResourceInitializer(syncResource: SyncResource, instantiationService?: IInstantiationService): AbstractInitializer {
		switch (syncResource) {
			case SyncResource.Settings: return new SettingsInitializer(this.fileService, this.environmentService, this.logService);
			case SyncResource.Keybindings: return new KeybindingsInitializer(this.fileService, this.environmentService, this.logService);
			case SyncResource.Snippets: return new SnippetsInitializer(this.fileService, this.environmentService, this.logService);
			case SyncResource.GlobalState: return new GlobalStateInitializer(this.storageService, this.fileService, this.environmentService, this.logService);
			case SyncResource.Extensions:
				if (!instantiationService) {
					throw new Error('Instantiation Service is required to initialize extension');
				}
				return instantiationService.createInstance(ExtensionsInitializer);
		}
	}

}

class InitializeOtherResourcesContribution implements IWorkbenchContribution {
	constructor(@IUserDataInitializationService userDataInitializeService: IUserDataInitializationService) {
		userDataInitializeService.initializeOtherResources();
	}
}

if (isWeb) {
	const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(Extensions.Workbench);
	workbenchRegistry.registerWorkbenchContribution(InitializeOtherResourcesContribution, LifecyclePhase.Restored);
}
